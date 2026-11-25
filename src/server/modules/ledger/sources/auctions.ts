import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../../db/app-db";
import {
  auctionOffer,
  paymentBatch,
  paymentReviewCase,
} from "../../../db/schema";
import type { PolicyContext } from "../../../access/can";
import { postToLedger } from "../post";
import { postingDescription } from "../descriptions";
import { SYSTEM_ACCOUNT_CODES as CODES } from "../domain/chart";
import { auctionCaptureLines } from "../../auctions/domain/proceeds";

/** Both original capture and reconciliation use the same immutable facts. */
export async function postAuctionSale(
  tx: AppDb,
  ctx: PolicyContext,
  offerId: string
) {
  const [offer] = await tx
    .select({
      id: auctionOffer.id,
      competitionId: auctionOffer.competitionId,
      amountPaise: auctionOffer.amountPaise,
      creatorShareBps: auctionOffer.creatorShareBps,
      paidAt: auctionOffer.paidAt,
      batchId: auctionOffer.batchId,
      paymentId: paymentBatch.gatewayPaymentId,
    })
    .from(auctionOffer)
    .leftJoin(paymentBatch, eq(paymentBatch.id, auctionOffer.batchId))
    .where(and(eq(auctionOffer.id, offerId), eq(auctionOffer.status, "paid")));
  if (!offer?.paidAt) return { outcome: "ignored" } as const;
  const [reviewed] =
    offer.batchId && offer.paymentId
      ? await tx
          .select({ id: paymentReviewCase.id })
          .from(paymentReviewCase)
          .where(
            and(
              eq(paymentReviewCase.batchId, offer.batchId),
              eq(paymentReviewCase.gatewayPaymentId, offer.paymentId),
              eq(paymentReviewCase.reason, "auction_capture_time_unknown"),
              eq(paymentReviewCase.outcome, "confirm")
            )
          )
      : [];
  // Timely evidence may settle a previously booked liability; recognize
  // income once by transferring that liability, not debiting clearing twice.
  // Backfill uses the identical path and first ensures the liability exists.
  if (reviewed && offer.batchId && offer.paymentId)
    await postAuctionReview(tx, ctx, offer.paymentId, offer.batchId);
  const lines = auctionCaptureLines(offer).map((line) =>
    reviewed && line.accountCode === CODES.gatewayClearing
      ? { ...line, accountCode: CODES.auctionReviewLiability }
      : line
  );
  return postToLedger(tx, ctx, {
    source: { type: "auction_sale", id: offer.id },
    competitionId: offer.competitionId,
    occurredAt: offer.paidAt,
    description: postingDescription("auction_sale"),
    lines,
  });
}
export async function postAuctionReview(
  tx: AppDb,
  ctx: PolicyContext,
  paymentId: string,
  batchId: string
) {
  const [row] = await tx
    .select({
      competitionId: auctionOffer.competitionId,
      amount: paymentReviewCase.amountMinor,
      openedAt: paymentReviewCase.openedAt,
    })
    .from(paymentReviewCase)
    .innerJoin(paymentBatch, eq(paymentBatch.id, paymentReviewCase.batchId))
    .innerJoin(auctionOffer, eq(auctionOffer.batchId, paymentBatch.id))
    .where(
      and(
        eq(paymentBatch.id, batchId),
        eq(paymentBatch.purpose, "auction_sale"),
        eq(paymentReviewCase.gatewayPaymentId, paymentId),
        eq(paymentReviewCase.currency, "INR")
      )
    );
  if (!row || row.amount <= 0n) return { outcome: "ignored" } as const;
  return postToLedger(tx, ctx, {
    source: { type: "auction_review", id: paymentId },
    competitionId: row.competitionId,
    occurredAt: row.openedAt,
    description: postingDescription("auction_review"),
    lines: [
      {
        accountCode: CODES.gatewayClearing,
        side: "debit",
        amountMinor: row.amount,
      },
      {
        accountCode: CODES.auctionReviewLiability,
        side: "credit",
        amountMinor: row.amount,
      },
    ],
  });
}
