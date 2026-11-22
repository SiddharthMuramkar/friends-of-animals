// Opening review cases (#79): captured payments a batch can't accept. The
// batch moves to needs_review, and each payment gets one case, with why
// and where the batch stood, so resolving it knows where the batch goes
// back to. Nothing is confirmed or refunded here.
//
// Each payment is reviewed once: a case is unique per batch and payment,
// and the capture decision skips payments that already have one, so a
// replayed or repeated signal opens nothing and writes no audit entry.
//
// Not a use case: syncBatch calls it in its transaction, with the batch
// locked. Loads under plain Node: relative imports only.

import { and, desc, eq, isNull } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  paymentBatch,
  paymentReviewCase,
  type PaymentBatchRow,
} from "../../db/schema";
import { monotonicUuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import {
  nextPaymentBatchStatus,
  type PaymentBatchStatus,
} from "./domain/batch-status";
import type { GatewayPayment } from "./domain/capture-decision";
import {
  BATCH_STATUSES_BEFORE_REVIEW,
  type BatchStatusBeforeReview,
  type PaymentReviewReason,
} from "./domain/review-case";

/** Cases opened at one instant still list in the order they opened. */
const nextCaseId = monotonicUuidv7();

export type ReviewedPayment = {
  payment: Pick<GatewayPayment, "id" | "amountMinor" | "currency">;
  reason: PaymentReviewReason;
};

function isBeforeReview(
  status: PaymentBatchStatus
): status is BatchStatusBeforeReview {
  return (BATCH_STATUSES_BEFORE_REVIEW as readonly string[]).includes(status);
}

/** The payment ids the batch accounts for: captured with, or in review. */
export async function knownPaymentIds(
  db: AppDb,
  batch: Pick<PaymentBatchRow, "id" | "gatewayPaymentId">
): Promise<string[]> {
  const reviewed = await db
    .select({ id: paymentReviewCase.gatewayPaymentId })
    .from(paymentReviewCase)
    .where(eq(paymentReviewCase.batchId, batch.id));
  return [batch.gatewayPaymentId, ...reviewed.map((row) => row.id)].filter(
    (id): id is string => id !== null
  );
}

/**
 * Where the batch stood before review: its status, or for a batch already
 * in review, what its open cases recorded.
 */
async function statusBeforeReview(
  tx: AppDb,
  batch: Pick<PaymentBatchRow, "id" | "status">
): Promise<BatchStatusBeforeReview> {
  if (isBeforeReview(batch.status)) return batch.status;
  const [open] = await tx
    .select({ before: paymentReviewCase.batchStatusBefore })
    .from(paymentReviewCase)
    .where(
      and(
        eq(paymentReviewCase.batchId, batch.id),
        isNull(paymentReviewCase.resolvedAt)
      )
    )
    .orderBy(desc(paymentReviewCase.openedAt))
    .limit(1);
  if (!open || !isBeforeReview(open.before)) {
    throw new Error(`Batch ${batch.id} is in review with no open case`);
  }
  return open.before;
}

/**
 * Puts `batch` (locked by the caller) in review and opens a case for each
 * payment. Returns the number of cases opened.
 */
export async function openReviewCases(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  batch: Pick<PaymentBatchRow, "id" | "status">,
  reviewed: readonly ReviewedPayment[],
  actorRole: Role | null
): Promise<number> {
  if (reviewed.length === 0) return 0;
  const batchStatusBefore = await statusBeforeReview(tx, batch);
  const move = nextPaymentBatchStatus(batch.status, "review_opened");
  if (!move.ok) throw new Error(`Batch ${batch.id} can't go to review`);
  const now = ctx.clock.now();
  if (batch.status !== move.to) {
    await tx
      .update(paymentBatch)
      .set({ status: move.to, updatedAt: now })
      .where(eq(paymentBatch.id, batch.id));
  }
  let opened = 0;
  for (const { payment, reason } of reviewed) {
    const caseId = nextCaseId(now);
    const [inserted] = await tx
      .insert(paymentReviewCase)
      .values({
        id: caseId,
        batchId: batch.id,
        reason,
        gatewayPaymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency.toUpperCase().slice(0, 3),
        batchStatusBefore,
        openedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: paymentReviewCase.id });
    if (!inserted) continue;
    opened += 1;
    await recordAudit(tx, ctx, {
      action: "payment.review_opened",
      entity: { type: "payment_review_case", id: caseId },
      before: { batchStatus: batch.status },
      after: {
        batchId: batch.id,
        batchStatus: move.to,
        reason,
        gatewayPaymentId: payment.id,
        amountMinor: payment.amountMinor.toString(),
        currency: payment.currency,
        batchStatusBefore,
      },
      actorRole,
    });
  }
  return opened;
}
