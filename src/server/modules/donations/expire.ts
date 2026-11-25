// expirePendingDonations() (#106): the worker's schedule (or the CLI)
// expires online donations whose checkout wasn't finished within
// `donations.pendingExpiryHours`. Each one's open order is synced with the
// gateway first, outside any transaction, so a donation paid with no
// signal in yet is captured instead of expired. An expired donation's
// batch is cancelled; money that still lands on it goes to payment review
// (#79), where finance may accept it.

import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { donation, paymentBatch } from "../../db/schema";
import type { ScheduleDefinition } from "../../outbox/schedules";
import type { ErrorReporter } from "../../ports/errors";
import { lockBatch } from "../payments/batches";
import { nextPaymentBatchStatus } from "../payments/domain/batch-status";
import { syncBatch, type SyncContext } from "../payments/sync-batch";
import { nextDonationStatus } from "./domain/donation-status";

/** Donations one run looks at; the next run takes the rest. */
const PAGE_SIZE = 100;

export type ExpirePendingDonationsResult = { ok: true; expired: number };

export async function expirePendingDonations(
  ctx: SyncContext & { errors: ErrorReporter }
): Promise<ExpirePendingDonationsResult> {
  const { role } = await authorize(ctx, "donation.expire");
  const now = ctx.clock.now();
  const due = await ctx.db
    .select({
      id: donation.id,
      batchId: donation.paymentBatchId,
      batchStatus: paymentBatch.status,
      gateway: paymentBatch.gateway,
    })
    .from(donation)
    .innerJoin(paymentBatch, eq(paymentBatch.id, donation.paymentBatchId))
    .where(
      and(
        inArray(donation.status, ["pending", "failed"]),
        lte(donation.expiresAt, now)
      )
    )
    .orderBy(asc(donation.expiresAt), asc(donation.id))
    .limit(PAGE_SIZE);

  let expired = 0;
  for (const each of due) {
    if (!each.batchId) continue;
    const batchId = each.batchId;
    if (
      each.batchStatus === "order_created" &&
      each.gateway === ctx.payments.name
    ) {
      try {
        await syncBatch(ctx, batchId, role);
      } catch (error) {
        // Unanswered: leave it for the next run rather than expire money
        // that may have arrived.
        ctx.errors.report(error, {
          where: "donations.expire",
          tags: { gateway: ctx.payments.name },
          extra: { donationId: each.id },
        });
        continue;
      }
    }
    const done = await ctx.db.transaction(async (tx) => {
      const batch = await lockBatch(tx, batchId);
      const [row] = await tx
        .select({ status: donation.status, expiresAt: donation.expiresAt })
        .from(donation)
        .where(eq(donation.id, each.id))
        .for("update");
      if (!batch || !row?.expiresAt || row.expiresAt > now) return false;
      const move = nextDonationStatus(row.status, "checkout_expired");
      if (!move.ok) return false;
      const batchMove = nextPaymentBatchStatus(batch.status, "expired");
      const stamp = ctx.clock.now();
      await tx
        .update(donation)
        .set({ status: move.to, updatedAt: stamp })
        .where(eq(donation.id, each.id));
      if (batchMove.ok) {
        await tx
          .update(paymentBatch)
          .set({ status: batchMove.to, updatedAt: stamp })
          .where(eq(paymentBatch.id, batch.id));
      }
      await recordAudit(tx, ctx, {
        action: "donation.expired",
        entity: { type: "donation", id: each.id },
        before: { status: row.status, batchStatus: batch.status },
        after: {
          status: move.to,
          batchStatus: batchMove.ok ? batchMove.to : batch.status,
        },
        actorRole: role,
      });
      return true;
    });
    if (done) expired += 1;
  }
  return { ok: true, expired };
}

export const donationWorker = { kind: "system", process: "worker" } as const;

export const expireDonationsSchedule: ScheduleDefinition = {
  name: "donations.expire_pending",
  cron: "17 * * * *",
  tz: "Asia/Kolkata",
  async run(deps) {
    await expirePendingDonations({ ...deps, actor: donationWorker });
  },
};
