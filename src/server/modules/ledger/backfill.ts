import { and, eq, gt, isNotNull, notExists, sql } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import {
  donation,
  auctionOffer,
  paymentReviewCase,
  ledgerPosting,
  offlinePayment,
  paymentBatch,
  refund,
} from "../../db/schema";
import type { ScheduleDefinition } from "../../outbox/schedules";
import type { ErrorReporter } from "../../ports/errors";

import {
  ledgerWorker,
  postDonation,
  postForeignDonation,
  postPaymentCapture,
  postRefund,
} from "./consumers";
import { postAuctionSale, postAuctionReview } from "./sources/auctions";
import {
  captureSource,
  eligibleCapture,
  UnsupportedCaptureCurrencyError,
} from "./sources/payments";

const RECONCILE_JOB = "ledger.reconcile_payments";
const PAGE_SIZE = 100;

async function postMissing(
  errors: ErrorReporter,
  sourceType:
    | "payment_batch"
    | "refund"
    | "donation"
    | "foreign_donation"
    | "auction_sale"
    | "auction_review",
  nextPage: (after: string | undefined) => PromiseLike<{ id: string }[]>,
  post: (id: string) => Promise<{ outcome: string }>
): Promise<number> {
  let after: string | undefined;
  let count = 0;
  while (true) {
    const rows = await nextPage(after);
    for (const { id } of rows) {
      try {
        if ((await post(id)).outcome === "posted") count += 1;
      } catch (error) {
        if (!(error instanceof UnsupportedCaptureCurrencyError)) throw error;
        errors.report(error, {
          where: RECONCILE_JOB,
          tags: { reason: error.code, sourceType },
          extra: { sourceId: id },
        });
      }
    }
    if (rows.length < PAGE_SIZE) return count;
    after = rows[rows.length - 1]!.id;
  }
}

/** Backfills old payments and reconciles missing deliveries in bounded pages. */
export async function backfillLedgerFromPayments(
  ctx: PolicyContext & { errors: ErrorReporter }
) {
  await authorize(ctx, "ledger.post_payment");
  const { db, errors } = ctx;
  const capturesPosted = await postMissing(
    errors,
    "payment_batch",
    (after) =>
      db
        .select({ id: paymentBatch.id })
        .from(paymentBatch)
        .leftJoin(offlinePayment, eq(offlinePayment.batchId, paymentBatch.id))
        .where(
          and(
            eligibleCapture(db),
            after === undefined ? undefined : gt(paymentBatch.id, after),
            notExists(
              db
                .select({ id: ledgerPosting.id })
                .from(ledgerPosting)
                .where(
                  and(
                    eq(ledgerPosting.sourceType, captureSource.type),
                    eq(ledgerPosting.sourceId, captureSource.id)
                  )
                )
            )
          )
        )
        .orderBy(paymentBatch.id)
        .limit(PAGE_SIZE),
    (batchId) => postPaymentCapture(ctx, { batchId })
  );
  // Donations (#106) before refunds, which reverse their postings.
  const donationsPosted = await postMissing(
    errors,
    "donation",
    (after) =>
      db
        .select({ id: donation.id })
        .from(donation)
        .where(
          and(
            isNotNull(donation.capturedAt),
            after === undefined ? undefined : gt(donation.id, after),
            notExists(
              db
                .select({ id: ledgerPosting.id })
                .from(ledgerPosting)
                .where(
                  and(
                    eq(ledgerPosting.sourceType, "donation"),
                    eq(ledgerPosting.sourceId, sql`${donation.id}::text`)
                  )
                )
            )
          )
        )
        .orderBy(donation.id)
        .limit(PAGE_SIZE),
    (donationId) => postDonation(ctx, { donationId })
  );
  const foreignPosted = await postMissing(
    errors,
    "foreign_donation",
    (after) =>
      db
        .select({ id: refund.id })
        .from(refund)
        .where(
          and(
            sql`${refund.kind} IN ('foreign_payment', 'recurring_after_cancel')`,
            after === undefined ? undefined : gt(refund.id, after),
            notExists(
              db
                .select({ id: ledgerPosting.id })
                .from(ledgerPosting)
                .where(
                  and(
                    sql`${ledgerPosting.sourceType} = CASE WHEN ${refund.kind} = 'recurring_after_cancel' THEN 'recurring_after_cancel' ELSE 'foreign_donation' END`,
                    eq(ledgerPosting.sourceId, refund.gatewayPaymentId)
                  )
                )
            )
          )
        )
        .orderBy(refund.id)
        .limit(PAGE_SIZE),
    (refundId) => postForeignDonation(ctx, { refundId })
  );
  const auctionSalesPosted = await postMissing(
    errors,
    "auction_sale",
    (after) =>
      db
        .select({ id: auctionOffer.id })
        .from(auctionOffer)
        .where(
          and(
            eq(auctionOffer.status, "paid"),
            after === undefined ? undefined : gt(auctionOffer.id, after),
            notExists(
              db
                .select({ id: ledgerPosting.id })
                .from(ledgerPosting)
                .where(
                  and(
                    eq(ledgerPosting.sourceType, "auction_sale"),
                    eq(ledgerPosting.sourceId, sql`${auctionOffer.id}::text`)
                  )
                )
            )
          )
        )
        .orderBy(auctionOffer.id)
        .limit(PAGE_SIZE),
    (offerId) => db.transaction((tx) => postAuctionSale(tx, ctx, offerId))
  );
  const auctionReviewsPosted = await postMissing(
    errors,
    "auction_review",
    (after) =>
      db
        .select({ id: paymentReviewCase.id })
        .from(paymentReviewCase)
        .innerJoin(paymentBatch, eq(paymentBatch.id, paymentReviewCase.batchId))
        .where(
          and(
            eq(paymentBatch.purpose, "auction_sale"),
            eq(paymentReviewCase.currency, "INR"),
            gt(paymentReviewCase.amountMinor, 0n),
            isNotNull(paymentReviewCase.gatewayPaymentId),
            after === undefined ? undefined : gt(paymentReviewCase.id, after),
            notExists(
              db
                .select({ id: ledgerPosting.id })
                .from(ledgerPosting)
                .where(
                  and(
                    eq(ledgerPosting.sourceType, "auction_review"),
                    eq(
                      ledgerPosting.sourceId,
                      paymentReviewCase.gatewayPaymentId
                    )
                  )
                )
            )
          )
        )
        .orderBy(paymentReviewCase.id)
        .limit(PAGE_SIZE),
    async (caseId) => {
      const [row] = await db
        .select({
          paymentId: paymentReviewCase.gatewayPaymentId,
          batchId: paymentReviewCase.batchId,
        })
        .from(paymentReviewCase)
        .where(eq(paymentReviewCase.id, caseId));
      if (!row?.paymentId) return { outcome: "ignored" };
      return db.transaction((tx) =>
        postAuctionReview(tx, ctx, row.paymentId!, row.batchId)
      );
    }
  );
  const refundsPosted = await postMissing(
    errors,
    "refund",
    (after) =>
      db
        .select({ id: refund.id })
        .from(refund)
        .where(
          and(
            eq(refund.status, "refunded"),
            sql`(${refund.kind} <> 'duplicate' OR EXISTS (SELECT 1 FROM ${paymentBatch} WHERE ${paymentBatch.id} = ${refund.batchId} AND ${paymentBatch.purpose} = 'auction_sale'))`,
            after === undefined ? undefined : gt(refund.id, after),
            notExists(
              db
                .select({ id: ledgerPosting.id })
                .from(ledgerPosting)
                .where(
                  and(
                    eq(ledgerPosting.sourceType, "refund"),
                    eq(ledgerPosting.sourceId, sql`${refund.id}::text`)
                  )
                )
            )
          )
        )
        .orderBy(refund.id)
        .limit(PAGE_SIZE),
    (refundId) => postRefund(ctx, { refundId })
  );
  return {
    capturesPosted: capturesPosted + auctionSalesPosted + auctionReviewsPosted,
    donationsPosted,
    foreignPosted,
    refundsPosted,
  };
}

export const reconcileLedgerSchedule: ScheduleDefinition = {
  name: RECONCILE_JOB,
  cron: "0 3 * * *",
  tz: "Asia/Kolkata",
  async run(deps) {
    await backfillLedgerFromPayments({ ...deps, actor: ledgerWorker });
  },
};
