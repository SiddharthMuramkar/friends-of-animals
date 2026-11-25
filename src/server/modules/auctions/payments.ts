import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  auctionOffer,
  paymentBatch,
  paymentReviewCase,
  refund,
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
import { timelyCaptureEvidence } from "../payments/capture-evidence";
import type { PurposeContext } from "../payments/purposes";
import type { SyncOutcome } from "../payments/domain/outcomes";
import { lockBatch } from "../payments/batches";
import { postAuctionSale, postAuctionReview } from "../ledger/sources/auctions";
import { eligibleOffer, lockOfferLot } from "./checkout";
import { applyMove } from "./lifecycle";
import { changeOffer } from "./offers";

const UNKNOWN_TIMING = "auction_capture_time_unknown" as const;

/** Every genuine new domestic capture is booked as a sale or liability.
 * The gateway's captured status is necessary but only actual observation
 * before the deadline or a matching signed capture event proves timeliness.
 * An ambiguous full capture holds its offer pending positive evidence or
 * explicit finance adjudication. Caller already holds the payment batch. */
export async function syncAuctionBatch(
  tx: AppDb,
  ctx: PurposeContext,
  batch: PaymentBatchRow,
  payments: readonly GatewayPayment[],
  role: Role | null,
  observedAt: Date
): Promise<SyncOutcome> {
  const [offer] = await tx
    .select({ id: auctionOffer.id })
    .from(auctionOffer)
    .where(eq(auctionOffer.batchId, batch.id));
  if (!offer) throw new Error("Auction batch has no offer");
  const found = await lockOfferLot(tx, offer.id);
  if (!found) throw new Error("Auction offer missing");
  const captures = [...new Map(payments.map((p) => [p.id, p])).values()].filter(
    (p) => p.orderId === batch.gatewayOrderId && p.status === "captured"
  );
  const known = new Set(await knownPaymentIds(tx, batch));
  const fresh = captures.filter((p) => !known.has(p.id));
  const ambiguous = await tx
    .select()
    .from(paymentReviewCase)
    .where(
      and(
        eq(paymentReviewCase.batchId, batch.id),
        eq(paymentReviewCase.reason, UNKNOWN_TIMING),
        isNull(paymentReviewCase.resolvedAt)
      )
    );
  const canSettle =
    (batch.status === "order_created" || batch.status === "needs_review") &&
    (await eligibleOffer({ ...ctx, db: tx }, found));
  const matches = (p: GatewayPayment) =>
    p.amountMinor === batch.amountMinor &&
    p.currency === "INR" &&
    !p.international;
  const timely = async (p: GatewayPayment) =>
    (+observedAt >= +found.offer.offeredAt &&
      +observedAt < +found.offer.expiresAt) ||
    (await timelyCaptureEvidence(
      tx,
      batch,
      p.id,
      found.offer.offeredAt,
      found.offer.expiresAt
    ));
  let accepted: GatewayPayment | undefined;
  let resolved: (typeof ambiguous)[number] | undefined;
  if (canSettle) {
    for (const p of captures) {
      if (!matches(p)) continue;
      const prior = ambiguous.find((c) => c.gatewayPaymentId === p.id);
      if (!(prior || !known.has(p.id))) continue;
      if (!(await timely(p))) continue;
      accepted = p;
      resolved = prior;
      break;
    }
  }
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
    if (resolved) {
      await tx
        .update(paymentReviewCase)
        .set({
          outcome: "confirm",
          resolutionReason:
            "Provider capture evidence establishes payment before the auction deadline.",
          resolvedAt: now,
          resolvedByUserId: null,
          refundDue: false,
        })
        .where(eq(paymentReviewCase.id, resolved.id));
      await recordAudit(tx, ctx, {
        action: "payment.review_resolved",
        entity: { type: "payment_review_case", id: resolved.id },
        before: { outcome: null, batchStatus: batch.status },
        after: {
          outcome: "confirm",
          refundDue: false,
          batchId: batch.id,
          batchStatus: "captured",
          evidence: "timely_provider_capture",
        },
        actorRole: role,
      });
    }
    await recordAudit(tx, ctx, {
      action: "payment.batch_captured",
      entity: { type: "payment_batch", id: batch.id },
      before: { status: batch.status },
      after: {
        status: "captured",
        purpose: "auction_sale",
        gatewayPaymentId: accepted.id,
        evidence: "timely_provider_capture",
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
  const review: ReviewedPayment[] = [];
  for (const payment of fresh) {
    if (payment === accepted) continue;
    review.push({
      payment,
      reason:
        batch.status === "captured" || accepted
          ? "already_paid"
          : !matches(payment)
            ? "amount_mismatch"
            : canSettle && !(await timely(payment))
              ? UNKNOWN_TIMING
              : "batch_superseded",
    });
  }
  if (review.length) {
    const current = await lockBatch(tx, batch.id);
    if (!current) throw new Error("Batch vanished");
    await openReviewCases(tx, ctx, current, review, role);
    for (const { payment } of review)
      if (payment.currency === "INR" && payment.amountMinor > 0n)
        await postAuctionReview(tx, ctx, payment.id, batch.id);
  }
  return accepted
    ? "captured"
    : review.length || batch.status === "needs_review"
      ? "needs_review"
      : batch.status === "captured"
        ? "already_captured"
        : "awaiting_payment";
}

/** Only ambiguous full captures hold fallback. A resolved duplicate
 * refund must actually settle before the original can be offered again. */
export async function hasUnadjudicatedAuctionCapture(
  tx: AppDb,
  batchId: string
) {
  const cases = await tx
    .select({ review: paymentReviewCase, refundStatus: refund.status })
    .from(paymentReviewCase)
    .leftJoin(refund, eq(refund.reviewCaseId, paymentReviewCase.id))
    .where(
      and(
        eq(paymentReviewCase.batchId, batchId),
        eq(paymentReviewCase.reason, UNKNOWN_TIMING)
      )
    );
  return cases.some(
    ({ review, refundStatus }) =>
      !review.resolvedAt ||
      (review.outcome === "refund" && refundStatus !== "refunded")
  );
}

export async function recheckAuctionAfterReview(
  tx: AppDb,
  ctx: Pick<PurposeContext, "clock">,
  batchId: string
) {
  const [offer] = await tx
    .select({ id: auctionOffer.id })
    .from(auctionOffer)
    .where(
      and(eq(auctionOffer.batchId, batchId), eq(auctionOffer.status, "open"))
    );
  if (offer)
    await emit(tx, ctx.clock, {
      type: "auction.offer.expire",
      aggregate: { type: "auction_offer", id: offer.id },
      payload: { offerId: offer.id },
    });
}

// Finance may adjudicate ambiguous money by refunding or keeping with an
// explicit reason. No manual confirmation guesses a capture instant and
// every later automatic confirmation must still use actual provider truth.
export function acceptReviewedAuction(): Promise<void> {
  throw new Error(
    "Auction review cannot confirm a sale without timely evidence"
  );
}

export async function settleAuctionRefund(
  tx: AppDb,
  ctx: Pick<PurposeContext, "clock" | "actor">,
  refundId: string
): Promise<void> {
  const [row] = await tx
    .select({ batchId: refund.batchId })
    .from(refund)
    .where(eq(refund.id, refundId));
  if (row) await recheckAuctionAfterReview(tx, ctx, row.batchId);
}
