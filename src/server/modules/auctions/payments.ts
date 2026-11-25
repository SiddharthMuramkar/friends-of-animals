import { eq } from "drizzle-orm";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  auctionOffer,
  paymentBatch,
  type PaymentBatchRow,
} from "../../db/schema";
import type { Role } from "../../access/domain/roles";
import type { GatewayPayment } from "../../ports/payment-gateway";
import { emit } from "../../outbox/emit";
import {
  knownPaymentIds,
  openReviewCases,
  type ReviewedPayment,
} from "../payments/open-review-case";
import type { PurposeContext } from "../payments/purposes";
import type { SyncOutcome } from "../payments/domain/outcomes";
import { lockBatch } from "../payments/batches";
import { postAuctionSale, postAuctionReview } from "../ledger/sources/auctions";
import { lockOfferLot, payableOffer } from "./checkout";
import { applyMove } from "./lifecycle";
import { changeOffer } from "./offers";

/** Every genuine new domestic capture is booked as a sale or held as a
 * liability until returned. Only an active, consented, reserve-met offer
 * before its exact deadline may sell its lot. */
export async function syncAuctionBatch(
  tx: AppDb,
  ctx: PurposeContext,
  batch: PaymentBatchRow,
  payments: readonly GatewayPayment[],
  role: Role | null
): Promise<SyncOutcome> {
  const [offer] = await tx
    .select({ id: auctionOffer.id })
    .from(auctionOffer)
    .where(eq(auctionOffer.batchId, batch.id));
  if (!offer) throw new Error("Auction batch has no offer");
  const found = await lockOfferLot(tx, offer.id);
  if (!found) throw new Error("Auction offer missing");
  const known = new Set(await knownPaymentIds(tx, batch));
  const fresh = [...new Map(payments.map((p) => [p.id, p])).values()].filter(
    (p) =>
      p.orderId === batch.gatewayOrderId &&
      p.status === "captured" &&
      !known.has(p.id)
  );
  if (!fresh.length)
    return batch.status === "captured"
      ? "already_captured"
      : batch.status === "needs_review"
        ? "needs_review"
        : "awaiting_payment";
  const payable =
    batch.status === "order_created" &&
    (await payableOffer({ ...ctx, db: tx }, found));
  const accepted = payable
    ? fresh.find(
        (p) =>
          p.amountMinor === batch.amountMinor &&
          p.currency === "INR" &&
          !p.international
      )
    : undefined;
  if (accepted && found.lot) {
    const now = ctx.clock.now();
    await tx
      .update(paymentBatch)
      .set({
        status: "captured",
        captureMethod: "gateway",
        gatewayPaymentId: accepted.id,
        capturedAt: now,
        updatedAt: now,
      })
      .where(eq(paymentBatch.id, batch.id));
    await recordAudit(tx, ctx, {
      action: "payment.batch_captured",
      entity: { type: "payment_batch", id: batch.id },
      before: { status: batch.status },
      after: {
        status: "captured",
        purpose: "auction_sale",
        gatewayPaymentId: accepted.id,
      },
      actorRole: role,
    });
    await changeOffer(tx, ctx, found.offer, "captured", role);
    await applyMove(tx, ctx, found.lot, "capture_payment", role);
    await postAuctionSale(tx, ctx, found.offer.id);
    await emit(tx, ctx.clock, {
      type: "auction.sale_captured",
      aggregate: { type: "auction_offer", id: offer.id },
      payload: { offerId: offer.id },
    });
  }
  const review: ReviewedPayment[] = fresh
    .filter((p) => p !== accepted)
    .map((payment) => ({
      payment,
      reason:
        batch.status === "captured" || accepted
          ? "already_paid"
          : payment.amountMinor !== batch.amountMinor ||
              payment.currency !== "INR" ||
              payment.international
            ? "amount_mismatch"
            : "batch_superseded",
    }));
  if (review.length) {
    const current = await lockBatch(tx, batch.id);
    if (!current) throw new Error("Batch vanished");
    await openReviewCases(tx, ctx, current, review, role);
    for (const { payment } of review)
      if (payment.currency === "INR" && payment.amountMinor > 0n)
        await postAuctionReview(tx, ctx, payment.id, batch.id);
  }
  return accepted ? "captured" : "needs_review";
}
// Auction review can never confirm a sale: the offer may have passed to
// another bidder and a sold original is never put back into custody.
export function acceptReviewedAuction(): Promise<void> {
  throw new Error("Auction review cannot confirm a sale");
}
export async function settleAuctionRefund(): Promise<void> {
  /* ledger refund consumer settles review money; custody never changes */
}
