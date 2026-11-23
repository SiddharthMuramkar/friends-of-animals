// resolvePaymentReviewCase({ caseId, outcome, reason }) (#79): staff
// decide a payment in review, with a reason (10 to 2,000 characters).
// Finance, staff admins and super admins, behind a fresh second factor.
//
// - confirm: accept the money. Through the capture path (./capture.ts),
//   with the reviewed payment: the batch is captured and its students are
//   confirmed with their numbers. Every student must still be waiting for
//   their fee; a newer batch still waiting for its payment that took them
//   over is cancelled and lets them go.
// - refund: the payer gets that payment back in full. A duplicate refund
//   (#80, ./refunds/start-system-refund.ts) is approved at once, with no
//   finance approval, and goes to the gateway from the outbox; the case
//   is marked `refund_due`. A captured batch stays captured.
// - keep: no money moves through the platform; the reason says why.
//
// What happens to the batch is decided by `planResolution`
// (./domain/review-case.ts): it leaves review when its last open case is
// resolved, to captured if the money was accepted or it was paid before
// review, else to cancelled, letting its students go so the payer can
// start again. Each resolution is written to the audit log, before and
// after, in the same transaction.

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  type PaymentBatchRow,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { endUnpaidBatch, lockBatch } from "./batches";
import { captureBatch, registrationsAtCapture } from "./capture";
import { startSystemRefund } from "./refunds/start-system-refund";
import {
  nextPaymentBatchStatus,
  type PaymentBatchStatus,
} from "./domain/batch-status";
import {
  BATCH_STATUSES_BEFORE_REVIEW,
  PAYMENT_REVIEW_OUTCOMES,
  planResolution,
  RESOLUTION_REASON_MAX_LENGTH,
  type BatchStatusBeforeReview,
  type ResolutionRefusal,
} from "./domain/review-case";

export type ResolvePaymentReviewCaseInput = {
  caseId: string;
  /** confirm, refund or keep. */
  outcome: string;
  reason: string;
};

export type ResolvePaymentReviewCaseResult =
  | { ok: true; batchStatus: PaymentBatchStatus }
  | InvalidInput
  | {
      ok: false;
      error: "not_found" | "registration_not_payable" | ResolutionRefusal;
    };

const resolveInput = z.object({
  caseId: z.uuid(),
  outcome: z.enum(PAYMENT_REVIEW_OUTCOMES),
  // Generous: the plan counts characters as a reader does and refuses
  // anything over the limit with its own refusal.
  reason: z.string().max(RESOLUTION_REASON_MAX_LENGTH * 8),
});

class NotPayable extends Error {}

function isBeforeReview(status: string): status is BatchStatusBeforeReview {
  return (BATCH_STATUSES_BEFORE_REVIEW as readonly string[]).includes(status);
}

export async function resolvePaymentReviewCase(
  ctx: UseCaseContext,
  input: ResolvePaymentReviewCaseInput
): Promise<ResolvePaymentReviewCaseResult> {
  const { role } = await authorize(ctx, "payments.review.resolve");
  const parsed = resolveInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const resolvedBy = ctx.actor.userId;
  const { caseId, outcome } = parsed.data;

  try {
    return await ctx.db.transaction(
      async (tx): Promise<ResolvePaymentReviewCaseResult> => {
        const [found] = await tx
          .select({ batchId: paymentReviewCase.batchId })
          .from(paymentReviewCase)
          .where(eq(paymentReviewCase.id, caseId));
        if (!found) return { ok: false, error: "not_found" };
        // The batch first, then its case: the order the capture funnel
        // locks them in.
        const batch = await lockBatch(tx, found.batchId);
        if (!batch) return { ok: false, error: "not_found" };
        const [reviewCase] = await tx
          .select()
          .from(paymentReviewCase)
          .where(eq(paymentReviewCase.id, caseId))
          .for("update");
        if (!reviewCase || !isBeforeReview(reviewCase.batchStatusBefore)) {
          return { ok: false, error: "not_found" };
        }
        const [others] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(paymentReviewCase)
          .where(
            and(
              eq(paymentReviewCase.batchId, batch.id),
              ne(paymentReviewCase.id, caseId),
              isNull(paymentReviewCase.resolvedAt)
            )
          );
        const plan = planResolution({
          reviewCase: {
            reason: reviewCase.reason,
            batchStatusBefore: reviewCase.batchStatusBefore,
            resolvedAt: reviewCase.resolvedAt,
          },
          outcome,
          resolutionReason: parsed.data.reason,
          otherOpenCases: others?.count ?? 0,
        });
        if (!plan.ok) return { ok: false, error: plan.refusal };

        const now = ctx.clock.now();
        let batchStatus: PaymentBatchStatus = batch.status;
        if (plan.confirmsRegistrations) {
          await takeBackRegistrations(tx, ctx, batch, role);
          const capture = await captureBatch(
            tx,
            ctx,
            batch,
            {
              event: "review_confirmed",
              method: "gateway",
              gatewayPaymentId: reviewCase.gatewayPaymentId,
            },
            role
          );
          if (!capture.ok) throw new NotPayable();
          batchStatus = "captured";
        } else if (plan.batchEvent && batch.status !== "captured") {
          // A captured batch paid again never left captured (#80).
          const move = nextPaymentBatchStatus(batch.status, plan.batchEvent);
          if (!move.ok) throw new Error(`Batch ${batch.id} can't leave review`);
          batchStatus = move.to;
          await tx
            .update(paymentBatch)
            .set({ status: move.to, updatedAt: now })
            .where(eq(paymentBatch.id, batch.id));
          if (plan.batchEvent === "review_dismissed") {
            // Nobody paid for them: the payer may start again.
            await tx
              .update(paymentBatchItem)
              .set({ releasedAt: now })
              .where(
                and(
                  eq(paymentBatchItem.batchId, batch.id),
                  isNull(paymentBatchItem.releasedAt)
                )
              );
          }
        }

        let refundId: string | null = null;
        if (plan.refundDue && reviewCase.currency === "INR") {
          const started = await startSystemRefund(tx, ctx, {
            kind: "duplicate",
            batchId: batch.id,
            reviewCaseId: caseId,
            gatewayPaymentId: reviewCase.gatewayPaymentId,
            amountMinor: reviewCase.amountMinor,
            reason: plan.resolutionReason,
            idempotencyKey: `review:${caseId}`,
            actorRole: role,
          });
          refundId = "refundId" in started ? started.refundId : null;
        }

        await tx
          .update(paymentReviewCase)
          .set({
            outcome: plan.outcome,
            resolutionReason: plan.resolutionReason,
            refundDue: plan.refundDue,
            resolvedAt: now,
            resolvedByUserId: resolvedBy,
          })
          .where(eq(paymentReviewCase.id, caseId));
        await recordAudit(tx, ctx, {
          action: "payment.review_resolved",
          entity: { type: "payment_review_case", id: caseId },
          before: { outcome: null, batchStatus: batch.status },
          after: {
            outcome: plan.outcome,
            refundDue: plan.refundDue,
            refundId,
            batchId: batch.id,
            batchStatus,
          },
          actorRole: role,
        });
        return { ok: true, batchStatus };
      }
    );
  } catch (error) {
    if (error instanceof NotPayable) {
      return { ok: false, error: "registration_not_payable" };
    }
    throw error;
  }
}

/**
 * Before confirming: every student the batch was made for must still wait
 * for their fee, and the batch must hold them again. A newer batch still
 * waiting for its payment that took them over is cancelled, letting them
 * go; one that is paid or in review keeps them, and nothing is confirmed.
 * Throws NotPayable, rolling the transaction back, when a student can't be
 * paid for.
 */
async function takeBackRegistrations(
  tx: AppDb,
  ctx: UseCaseContext,
  batch: PaymentBatchRow,
  actorRole: Role | null
): Promise<void> {
  const registrations = await registrationsAtCapture(tx, ctx, batch);
  if (
    registrations.length === 0 ||
    registrations.some((each) => each.standing !== "awaiting_payment")
  ) {
    throw new NotPayable();
  }
  const letGo = registrations
    .filter((each) => !each.heldByThisBatch)
    .map((each) => each.registrationId);
  if (letGo.length === 0) return;

  const holders = await tx
    .selectDistinct({ batchId: paymentBatchItem.batchId })
    .from(paymentBatchItem)
    .where(
      and(
        inArray(paymentBatchItem.registrationId, letGo),
        isNull(paymentBatchItem.releasedAt),
        ne(paymentBatchItem.batchId, batch.id)
      )
    );
  for (const { batchId } of holders) {
    const holder = await lockBatch(tx, batchId);
    if (!holder) continue;
    const ended = await endUnpaidBatch(
      tx,
      ctx,
      holder,
      "superseded",
      actorRole
    );
    if (!ended) throw new NotPayable();
  }
  await tx
    .update(paymentBatchItem)
    .set({ releasedAt: null })
    .where(
      and(
        eq(paymentBatchItem.batchId, batch.id),
        inArray(paymentBatchItem.registrationId, letGo)
      )
    );
}
