import { and, eq, gt, ne, notExists, sql } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import {
  ledgerPosting,
  offlinePayment,
  paymentBatch,
  refund,
} from "../../db/schema";
import type { ScheduleDefinition } from "../../outbox/schedules";
import type { ErrorReporter } from "../../ports/errors";

import { ledgerWorker, postPaymentCapture, postRefund } from "./consumers";
import { UnsupportedCaptureCurrencyError } from "./sources/payments";

const RECONCILE_JOB = "ledger.reconcile_payments";
const PAGE_SIZE = 100;

async function postMissing(
  errors: ErrorReporter,
  sourceType: "payment_batch" | "refund",
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
  const isOffline = sql`${paymentBatch.captureMethod} = 'offline'`;
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
            eq(paymentBatch.status, "captured"),
            after === undefined ? undefined : gt(paymentBatch.id, after),
            notExists(
              db
                .select({ id: ledgerPosting.id })
                .from(ledgerPosting)
                .where(
                  and(
                    eq(
                      ledgerPosting.sourceType,
                      sql`CASE WHEN ${isOffline} THEN 'offline_payment' ELSE 'payment_capture' END`
                    ),
                    eq(
                      ledgerPosting.sourceId,
                      sql`CASE WHEN ${isOffline} THEN ${offlinePayment.id}::text ELSE ${paymentBatch.gatewayPaymentId} END`
                    )
                  )
                )
            )
          )
        )
        .orderBy(paymentBatch.id)
        .limit(PAGE_SIZE),
    (batchId) => postPaymentCapture(ctx, { batchId })
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
  return { capturesPosted, refundsPosted };
}

export const reconcileLedgerSchedule: ScheduleDefinition = {
  name: RECONCILE_JOB,
  cron: "0 3 * * *",
  tz: "Asia/Kolkata",
  async run(deps) {
    await backfillLedgerFromPayments({ ...deps, actor: ledgerWorker });
  },
};
