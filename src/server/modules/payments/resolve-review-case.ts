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
  DASHBOARD_REFUND_REFERENCE_UNIQUE,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  type PaymentBatchRow,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { isUniqueViolation } from "../codes/codes";
import {
  endUnpaidBatch,
  lockBatch,
  lockBatchAndParticipation,
} from "./batches";
import { captureBatch, registrationsAtCapture } from "./capture";
import { refundRegistrations } from "./refunds/rows";
import { startSystemRefund } from "./refunds/start-system-refund";
import { dashboardRefundPending } from "./review-cases";
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
  | {
      ok: true;
      batchStatus: PaymentBatchStatus;
      manualRefundRequired?: { currency: string };
    }
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
  // A refund due in a currency refunds can't send, told once committed.
  const told: { byHand: { currency: string; batchId: string } | null } = {
    byHand: null,
  };

  try {
    const result = await ctx.db.transaction(
      async (tx): Promise<ResolvePaymentReviewCaseResult> => {
        const [found] = await tx
          .select({ batchId: paymentReviewCase.batchId })
          .from(paymentReviewCase)
          .where(eq(paymentReviewCase.id, caseId));
        if (!found) return { ok: false, error: "not_found" };
        // Hold individual participation before the batch and review case.
        const batch = await lockBatchAndParticipation(tx, found.batchId);
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
            amountMinor: reviewCase.amountMinor,
            currency: reviewCase.currency,
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
        // Refunds go out in rupees only (the refund row is INR). Money that
        // came in another currency is refunded by hand from the gateway's
        // dashboard: the audit entry says so, and so does the error
        // tracker, so nobody waits for a refund that will never start.
        const refundByHand =
          plan.refundDue && reviewCase.currency !== "INR"
            ? ("currency_not_inr" as const)
            : null;
        if (refundByHand) {
          told.byHand = { currency: reviewCase.currency, batchId: batch.id };
        }
        if (plan.refundDue && !refundByHand) {
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
            ...(refundByHand ? { refundByHand } : {}),
            batchId: batch.id,
            batchStatus,
          },
          actorRole: role,
        });
        return refundByHand
          ? {
              ok: true,
              batchStatus,
              manualRefundRequired: { currency: reviewCase.currency },
            }
          : { ok: true, batchStatus };
      }
    );
    const { byHand } = told;
    if (result.ok && byHand) {
      ctx.errors.report(
        new Error(
          "A payment in review is due a refund in a currency refunds " +
            "can't send; refund it by hand from the gateway's dashboard"
        ),
        {
          where: "payments.resolveReviewCase",
          tags: { currency: byHand.currency },
          extra: { caseId, batchId: byHand.batchId },
        }
      );
    }
    return result;
  } catch (error) {
    if (error instanceof NotPayable) {
      return { ok: false, error: "registration_not_payable" };
    }
    throw error;
  }
}

export const dashboardRefundInput = z.strictObject({
  caseId: z.uuid(),
  reference: z.string().trim().min(1).max(200),
});

export type RecordDashboardRefundInput = z.input<typeof dashboardRefundInput>;

export type RecordDashboardRefundResult =
  | { ok: true }
  | InvalidInput
  | {
      ok: false;
      error: "not_pending" | "refund_unverified" | "reference_already_recorded";
    };

/** Verifies and records a refund already issued in the gateway dashboard. */
export async function recordDashboardRefund(
  ctx: UseCaseContext,
  input: RecordDashboardRefundInput
): Promise<RecordDashboardRefundResult> {
  const { role } = await authorize(ctx, "payments.review.resolve");
  const parsed = dashboardRefundInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { caseId, reference } = parsed.data;
  const pending = and(eq(paymentReviewCase.id, caseId), dashboardRefundPending);
  const [subject] = await ctx.db
    .select({
      batchId: paymentReviewCase.batchId,
      paymentId: paymentReviewCase.gatewayPaymentId,
      amountMinor: paymentReviewCase.amountMinor,
      currency: paymentReviewCase.currency,
      outcome: paymentReviewCase.outcome,
      gateway: paymentBatch.gateway,
    })
    .from(paymentReviewCase)
    .innerJoin(paymentBatch, eq(paymentBatch.id, paymentReviewCase.batchId))
    .where(pending);
  if (!subject?.outcome) return { ok: false, error: "not_pending" };
  const { paymentId, amountMinor, currency, outcome, batchId } = subject;
  if (!paymentId || subject.gateway !== ctx.payments.name) {
    return { ok: false, error: "refund_unverified" };
  }
  // Provider I/O stays outside the transaction. Recheck the receipt when
  // taking the unique claim so concurrent recorders can't reuse it.
  const refunds = await ctx.payments.fetchRefunds(paymentId);
  if (
    !refunds.some(
      (refund) =>
        refund.id === reference &&
        refund.paymentId === paymentId &&
        refund.amountMinor === amountMinor &&
        refund.currency === currency &&
        refund.status === "processed"
    )
  )
    return { ok: false, error: "refund_unverified" };

  try {
    return await ctx.db.transaction(async (tx) => {
      const batch = await (outcome === "confirm"
        ? lockBatchAndParticipation(tx, batchId)
        : lockBatch(tx, batchId));
      if (batch?.gateway !== subject.gateway) {
        return { ok: false, error: "not_pending" };
      }
      const [current] = await tx
        .select({ refundDue: paymentReviewCase.refundDue })
        .from(paymentReviewCase)
        .innerJoin(paymentBatch, eq(paymentBatch.id, paymentReviewCase.batchId))
        .where(
          and(
            pending,
            eq(paymentReviewCase.batchId, batchId),
            eq(paymentReviewCase.gatewayPaymentId, paymentId),
            eq(paymentReviewCase.amountMinor, amountMinor),
            eq(paymentReviewCase.currency, currency),
            eq(paymentReviewCase.outcome, outcome)
          )
        )
        .for("update", { of: paymentReviewCase });
      if (!current) return { ok: false, error: "not_pending" };
      await tx
        .update(paymentReviewCase)
        .set({ refundDue: false, dashboardRefundReference: reference })
        .where(eq(paymentReviewCase.id, caseId));

      const registrationsRefunded =
        outcome === "confirm"
          ? await refundRegistrations(tx, { batchId }, ctx.clock.now())
          : [];
      await recordAudit(tx, ctx, {
        action: "payment.dashboard_refund_recorded",
        entity: { type: "payment_review_case", id: caseId },
        before: { refundDue: current.refundDue },
        after: {
          refundDue: false,
          reference,
          batchId,
          paymentId,
          currency,
          amountMinor: amountMinor.toString(),
          registrationsRefunded,
        },
        actorRole: role,
      });
      return { ok: true };
    });
  } catch (error) {
    if (isUniqueViolation(error, DASHBOARD_REFUND_REFERENCE_UNIQUE)) {
      return { ok: false, error: "reference_already_recorded" };
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
