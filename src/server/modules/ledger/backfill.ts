import { and, eq, gt, isNotNull, ne, notExists, sql } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import {
  donation,
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
import {
  captureSource,
  eligibleCapture,
  UnsupportedCaptureCurrencyError,
} from "./sources/payments";

const RECONCILE_JOB = "ledger.reconcile_payments";
const PAGE_SIZE = 100;

async function postMissing(
  errors: ErrorReporter,
  sourceType: "payment_batch" | "refund" | "donation" | "foreign_donation",
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
            ne(refund.kind, "duplicate"),
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
  return { capturesPosted, donationsPosted, foreignPosted, refundsPosted };
}

export const reconcileLedgerSchedule: ScheduleDefinition = {
  name: RECONCILE_JOB,
  cron: "0 3 * * *",
  tz: "Asia/Kolkata",
  async run(deps) {
    await backfillLedgerFromPayments({ ...deps, actor: ledgerWorker });
  },
};
