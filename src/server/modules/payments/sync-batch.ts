// syncBatch(ctx, batchId, actorRole) (#77): the one path by which a batch
// gets paid by the gateway. Every signal (the Checkout return, a webhook,
// paying again, later a sweep) only names a batch; this reads the order's
// payments back from the gateway, outside any transaction, then decides in
// one transaction with the batch locked (decideCapture,
// ./domain/capture-decision.ts):
//
// - capture: through the capture path (./capture.ts): the batch is
//   captured, every registration it holds is confirmed with its number,
//   and the receipt and confirmations go to the outbox;
// - money the batch can't accept (#79): a registration already paid,
//   withdrawn or past the registration close, an amount that isn't the
//   batch's, a batch replaced by a newer one, or a second payment on a
//   batch that is paid or in review. The batch moves to needs_review and
//   each such payment gets one review case (./open-review-case.ts), the
//   reason picked by `reviewReasonFor` (./domain/review-case.ts). Nothing
//   is confirmed and nothing is refunded;
// - otherwise nothing changes.
//
// It doesn't matter how often, or in what order, the signals arrive: a
// payment the batch was captured with, or that has a case, is never acted
// on again, so a batch confirms once and a payment is reviewed once, with
// one audit entry.

import { eq } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import { paymentBatch } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { lockBatch } from "./batches";
import { captureBatch, registrationsAtCapture } from "./capture";
import { decideCapture, type GatewayPayment } from "./domain/capture-decision";
import type { SyncOutcome } from "./domain/outcomes";
import {
  reviewReasonFor,
  type PaymentReviewReason,
} from "./domain/review-case";
import { knownPaymentIds, openReviewCases } from "./open-review-case";

export async function syncBatch(
  ctx: UseCaseContext,
  batchId: string,
  actorRole: Role | null
): Promise<SyncOutcome> {
  const [found] = await ctx.db
    .select({
      status: paymentBatch.status,
      gateway: paymentBatch.gateway,
      orderId: paymentBatch.gatewayOrderId,
    })
    .from(paymentBatch)
    .where(eq(paymentBatch.id, batchId));
  if (!found) return "awaiting_payment";
  // Only the gateway that made the order can say whether it was paid.
  if (!found.orderId || found.gateway !== ctx.payments.name) {
    if (found.status === "captured") return "already_captured";
    return found.status === "needs_review"
      ? "needs_review"
      : "awaiting_payment";
  }
  const payments = await ctx.payments.fetchOrderPayments(found.orderId);

  return ctx.db.transaction(async (tx): Promise<SyncOutcome> => {
    const batch = await lockBatch(tx, batchId);
    if (!batch) return "awaiting_payment";
    const decision = decideCapture(
      {
        status: batch.status,
        orderId: batch.gatewayOrderId,
        amountMinor: batch.amountMinor,
        currency: "INR",
        knownPaymentIds: await knownPaymentIds(tx, batch),
      },
      payments
    );
    const paymentNamed = (id: string): GatewayPayment => {
      const payment = payments.find((each) => each.id === id);
      if (!payment) throw new Error(`No payment ${id} on the order`);
      return payment;
    };
    const review = async (
      reviewed: { paymentId: string; reason: PaymentReviewReason }[]
    ) => {
      await openReviewCases(
        tx,
        ctx,
        batch,
        reviewed.map(({ paymentId, reason }) => ({
          payment: paymentNamed(paymentId),
          reason,
        })),
        actorRole
      );
    };
    const entity = { type: "payment_batch" as const, id: batch.id };
    switch (decision.kind) {
      case "already_captured":
      case "awaiting_payment":
        return decision.kind;
      case "in_review":
        return "needs_review";
      case "extra_captures":
        // The batch is paid, or its payment is in review: each new one is
        // a second payment.
        await review(
          decision.paymentIds.map((paymentId) => ({
            paymentId,
            reason: "already_paid",
          }))
        );
        return "needs_review";
      case "amount_mismatch": {
        const paid = paymentNamed(decision.paymentId);
        await recordAudit(tx, ctx, {
          action: "payment.amount_mismatch",
          entity,
          before: { status: batch.status },
          after: {
            gatewayPaymentId: decision.paymentId,
            capturedMinor: paid.amountMinor.toString(),
            batchMinor: batch.amountMinor.toString(),
          },
          actorRole,
        });
        const reason =
          reviewReasonFor({
            amountMatches: false,
            registrations: await registrationsAtCapture(tx, ctx, batch),
          }) ?? "amount_mismatch";
        await review([{ paymentId: decision.paymentId, reason }]);
        return "needs_review";
      }
      case "not_payable": {
        await recordAudit(tx, ctx, {
          action: "payment.capture_not_payable",
          entity,
          before: { status: batch.status },
          after: { gatewayPaymentId: decision.paymentId },
          actorRole,
        });
        // A batch that failed or was replaced holds nothing any more: if
        // nothing else rules its money out, a newer batch took over.
        const reason =
          reviewReasonFor({
            amountMatches: true,
            registrations: await registrationsAtCapture(tx, ctx, batch),
          }) ?? "batch_superseded";
        await review([{ paymentId: decision.paymentId, reason }]);
        return "needs_review";
      }
      case "capture":
        break;
    }

    const others = decision.otherCapturedIds.map((paymentId) => ({
      paymentId,
      reason: "already_paid" as const,
    }));
    const refusal = reviewReasonFor({
      amountMatches: true,
      registrations: await registrationsAtCapture(tx, ctx, batch),
    });
    if (refusal) {
      await review([
        { paymentId: decision.paymentId, reason: refusal },
        ...others,
      ]);
      return "needs_review";
    }

    await captureBatch(
      tx,
      ctx,
      batch,
      {
        event: "captured",
        method: "gateway",
        gatewayPaymentId: decision.paymentId,
      },
      actorRole
    );
    if (others.length > 0) {
      // Paid twice on one order: the batch is paid, and the rest go to
      // review for staff to refund or keep (#79, #80).
      await recordAudit(tx, ctx, {
        action: "payment.extra_capture",
        entity,
        before: null,
        after: { gatewayPaymentIds: decision.otherCapturedIds },
        actorRole,
      });
      const captured = await lockBatch(tx, batch.id);
      if (!captured) throw new Error(`Batch ${batch.id} vanished`);
      await openReviewCases(
        tx,
        ctx,
        captured,
        others.map(({ paymentId, reason }) => ({
          payment: paymentNamed(paymentId),
          reason,
        })),
        actorRole
      );
    }
    return "captured";
  });
}
