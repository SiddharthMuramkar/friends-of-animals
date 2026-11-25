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
    })
    .from(auctionOffer)
    .where(and(eq(auctionOffer.id, offerId), eq(auctionOffer.status, "paid")));
  if (!offer?.paidAt) return { outcome: "ignored" } as const;
  return postToLedger(tx, ctx, {
    source: { type: "auction_sale", id: offer.id },
    competitionId: offer.competitionId,
    occurredAt: offer.paidAt,
    description: postingDescription("auction_sale"),
    lines: auctionCaptureLines(offer),
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
