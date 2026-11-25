import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { authorize, can } from "../../../access/can";
import { recurringDonation } from "../../../db/schema";
import { emit } from "../../../outbox/emit";
import type { ScheduleDefinition } from "../../../outbox/schedules";
import { ENDED_SUBSCRIPTION_STATUSES } from "../../../ports/subscription-gateway";
import type { UseCaseContext } from "../../../use-cases";
import { canCancelRecurring } from "./domain/recurring-status";
import {
  recurringAudit,
  recurringWorker,
  syncRecurringDonation,
  type SyncContext,
} from "./sync";

async function requestCancel(
  ctx: SyncContext,
  id: string,
  by: "donor" | "finance" | "system"
) {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(recurringDonation)
      .where(eq(recurringDonation.id, id))
      .for("update");
    if (!row) return null;
    if (!canCancelRecurring(row.status) || row.cancelRequestedAt) return row;
    const now = ctx.clock.now();
    await tx
      .update(recurringDonation)
      .set({
        cancelRequestedAt: now,
        cancelRequestedBy: by,
        nextChargeAt: null,
        updatedAt: now,
      })
      .where(eq(recurringDonation.id, id));
    await recurringAudit(
      tx,
      ctx,
      id,
      "cancel_requested",
      { status: row.status },
      { status: row.status, by }
    );
    await emit(tx, ctx.clock, {
      type: "recurring_donation.cancel_requested",
      aggregate: { type: "recurring_donation", id },
      payload: { id },
    });
    return row;
  });
}

export async function sendRecurringCancel(ctx: SyncContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(recurringDonation)
    .where(eq(recurringDonation.id, id));
  if (!row || !row.cancelRequestedAt) return null;
  if (row.gateway !== ctx.payments.name)
    throw new Error("Recurring gateway unavailable");
  const remote = await ctx.payments.fetchSubscription(
    row.gatewaySubscriptionId
  );
  if (!ENDED_SUBSCRIPTION_STATUSES.has(remote.status)) {
    try {
      await ctx.payments.cancelSubscription(row.gatewaySubscriptionId, {
        atCycleEnd: false,
      });
    } catch (error) {
      // Either our previous call succeeded with its answer lost, or another
      // delivery cancelled it concurrently; adopt the verified terminal state.
      const fresh = await ctx.payments.fetchSubscription(
        row.gatewaySubscriptionId
      );
      if (!ENDED_SUBSCRIPTION_STATUSES.has(fresh.status)) throw error;
    }
  }
  return syncRecurringDonation(ctx, row.gatewaySubscriptionId);
}

export async function cancelRecurringDonation(
  ctx: UseCaseContext,
  input: { id: string }
) {
  if (!z.uuid().safeParse(input.id).success)
    return { ok: false, error: "not_found" } as const;
  const [row] = await ctx.db
    .select()
    .from(recurringDonation)
    .where(eq(recurringDonation.id, input.id));
  if (!row) return { ok: false, error: "not_found" } as const;
  const owned = ctx.actor.kind === "user" && ctx.actor.userId === row.userId;
  const resource = { ownerId: row.userId ?? undefined };
  if (
    !owned &&
    !(await can(ctx, "recurring_donation.cancel", resource)).allowed
  )
    return { ok: false, error: "not_found" } as const;
  await authorize(ctx, "recurring_donation.cancel", resource);
  if (!canCancelRecurring(row.status))
    return { ok: true, status: row.status } as const;
  await requestCancel(ctx, row.id, owned ? "donor" : "finance");
  try {
    const status = await sendRecurringCancel(ctx, row.id);
    return { ok: true, status: status ?? "cancel_pending" } as const;
  } catch {
    // Transactional delivery retries independently of the HTTP request.
    return { ok: true, status: "cancel_pending" } as const;
  }
}

export async function expireAbandonedRecurringDonations(ctx: SyncContext) {
  await authorize(ctx, "recurring_donation.expire");
  const olderThan = new Date(ctx.clock.now().getTime() - 24 * 60 * 60 * 1000);
  const rows = await ctx.db
    .select()
    .from(recurringDonation)
    .where(
      and(
        eq(recurringDonation.status, "pending_authorisation"),
        eq(recurringDonation.gateway, ctx.payments.name),
        lte(recurringDonation.createdAt, olderThan)
      )
    );
  for (const row of rows) {
    const remote = await ctx.payments.fetchSubscription(
      row.gatewaySubscriptionId
    );
    if (remote.status === "created") {
      await requestCancel(ctx, row.id, "system");
      await sendRecurringCancel(ctx, row.id);
    } else await syncRecurringDonation(ctx, row.gatewaySubscriptionId);
  }
  return { ok: true } as const;
}
export const recurringExpirySchedule: ScheduleDefinition = {
  name: "donations.expire_abandoned_recurring",
  cron: "21 * * * *",
  tz: "Asia/Kolkata",
  async run(deps) {
    await expireAbandonedRecurringDonations({
      ...deps,
      actor: recurringWorker,
    });
  },
};
