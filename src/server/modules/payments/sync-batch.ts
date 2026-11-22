// syncBatch(ctx, batchId, actorRole) (#77): the one path by which a batch
// gets paid. Every signal (the Checkout return, a webhook, later #79's
// sweep) only names a batch; this reads the order's payments back from the
// gateway, outside any transaction, then decides in one transaction with
// the batch locked (decideCapture, ./domain/capture-decision.ts):
//
// - capture: the batch is captured, every registration it holds is
//   confirmed with its number, and the receipt and confirmations go to the
//   outbox, all in that transaction;
// - an amount that isn't the batch's, or money for a batch that was
//   cancelled, confirms nothing and is written to the audit log for
//   finance (#79 turns these into review cases);
// - otherwise nothing changes.
//
// It doesn't matter how often, or in what order, the signals arrive: a
// captured batch stays as it is, so it confirms once.

import { eq } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import { competition, paymentBatch } from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { confirmRegistrations } from "../registration/confirm";
import { heldItems, lockBatch } from "./batches";
import { nextPaymentBatchStatus } from "./domain/batch-status";
import { decideCapture } from "./domain/capture-decision";
import type { SyncOutcome } from "./domain/outcomes";

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
  if (found.status === "captured") return "already_captured";
  // Only the gateway that made the order can say whether it was paid.
  if (!found.orderId || found.gateway !== ctx.payments.name) {
    return "awaiting_payment";
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
      },
      payments
    );
    const entity = { type: "payment_batch" as const, id: batch.id };
    switch (decision.kind) {
      case "already_captured":
      case "awaiting_payment":
        return decision.kind;
      case "amount_mismatch": {
        const paid = payments.find((each) => each.id === decision.paymentId);
        await recordAudit(tx, ctx, {
          action: "payment.amount_mismatch",
          entity,
          before: { status: batch.status },
          after: {
            gatewayPaymentId: decision.paymentId,
            capturedMinor: paid?.amountMinor.toString() ?? null,
            batchMinor: batch.amountMinor.toString(),
          },
          actorRole,
        });
        return "amount_mismatch";
      }
      case "not_payable":
        await recordAudit(tx, ctx, {
          action: "payment.capture_not_payable",
          entity,
          before: { status: batch.status },
          after: { gatewayPaymentId: decision.paymentId },
          actorRole,
        });
        return "not_payable";
      case "capture":
        break;
    }

    const move = nextPaymentBatchStatus(batch.status, "captured");
    if (!move.ok) throw new Error(`Batch ${batch.id} can't be captured`);
    const now = ctx.clock.now();
    await tx
      .update(paymentBatch)
      .set({
        status: move.to,
        gatewayPaymentId: decision.paymentId,
        capturedAt: now,
        updatedAt: now,
      })
      .where(eq(paymentBatch.id, batch.id));
    const [target] = await tx
      .select({ code: competition.code })
      .from(competition)
      .where(eq(competition.id, batch.competitionId));
    if (!target) throw new Error(`Batch ${batch.id} has no competition`);
    const held = await heldItems(tx, batch.id);
    const { confirmed, refused } = await confirmRegistrations(tx, ctx, {
      registrationIds: held.map((item) => item.registrationId),
      competitionCode: target.code,
      batchId: batch.id,
      actorRole,
    });
    await recordAudit(tx, ctx, {
      action: "payment.batch_captured",
      entity,
      before: { status: batch.status },
      after: {
        status: move.to,
        gatewayPaymentId: decision.paymentId,
        capturedAt: now.toISOString(),
        confirmed: confirmed.length,
        // Withdrawn after the order opened: paid for, but not confirmed.
        // Refunds (#80) settle them.
        notConfirmed: refused,
      },
      actorRole,
    });
    if (decision.otherCapturedIds.length > 0) {
      // Paid twice on one order: for finance to refund (#79, #80).
      await recordAudit(tx, ctx, {
        action: "payment.extra_capture",
        entity,
        before: null,
        after: { gatewayPaymentIds: decision.otherCapturedIds },
        actorRole,
      });
    }
    await emit(tx, ctx.clock, {
      type: "payment.batch_captured",
      aggregate: entity,
      payload: { batchId: batch.id, payerUserId: batch.payerUserId },
    });
    return "captured";
  });
}
