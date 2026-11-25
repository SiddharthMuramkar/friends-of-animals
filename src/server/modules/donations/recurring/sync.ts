import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../../db/app-db";
import {
  donation,
  paymentBatch,
  recurringDonation,
  recurringChargeFailure,
  recurringRefusedCharge,
  type RecurringDonationRow,
} from "../../../db/schema";
import type { Actor } from "../../../actor";
import { uuidv7 } from "../../../ids";
import { recordAudit } from "../../../audit/record";
import { emit } from "../../../outbox/emit";
import type { OutboxDeps } from "../../../outbox/handlers";
import { readSetting } from "../../settings/read";
import { startSystemRefund } from "../../payments/refunds/start-system-refund";
import { decideDonationPayments } from "../domain/donation-capture";
import { captureDonation } from "../payments";
import { planRecurringSync, type RemoteCharge } from "./domain/recurring-sync";

export type SyncContext = Pick<
  OutboxDeps,
  "db" | "clock" | "payments" | "cipher" | "settings"
> & { actor: Actor };
export const recurringWorker = { kind: "system", process: "worker" } as const;

export async function recurringAudit(
  tx: AppDb,
  ctx: SyncContext,
  id: string,
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
) {
  await recordAudit(tx, ctx, {
    action: `recurring_donation.${action}`,
    entity: { type: "recurring_donation", id },
    before,
    after,
    actorRole: null,
  });
}

export async function syncRecurringDonation(
  ctx: SyncContext,
  subscriptionId: string
) {
  const [found] = await ctx.db
    .select()
    .from(recurringDonation)
    .where(
      and(
        eq(recurringDonation.gatewaySubscriptionId, subscriptionId),
        eq(recurringDonation.gateway, ctx.payments.name)
      )
    );
  if (!found) return null;
  const remote = await ctx.payments.fetchSubscription(subscriptionId);
  if (remote.id !== subscriptionId || remote.planId !== found.gatewayPlanId)
    throw new Error("Recurring subscription does not match the stored plan");
  const remoteCharges =
    await ctx.payments.fetchSubscriptionCharges(subscriptionId);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(recurringDonation)
      .where(eq(recurringDonation.id, found.id))
      .for("update");
    if (!row) return null;
    const captured = await tx
      .select({ id: donation.gatewayPaymentId })
      .from(donation)
      .where(eq(donation.recurringDonationId, row.id));
    const refused = await tx
      .select({ id: recurringRefusedCharge.gatewayPaymentId })
      .from(recurringRefusedCharge)
      .where(eq(recurringRefusedCharge.recurringDonationId, row.id));
    const failures = await tx
      .select({ cycle: recurringChargeFailure.cycleKey })
      .from(recurringChargeFailure)
      .where(eq(recurringChargeFailure.recurringDonationId, row.id));
    const now = ctx.clock.now();
    const plan = planRecurringSync(row, remote, remoteCharges, {
      now,
      handledPaymentIds: new Set(
        [...captured, ...refused].flatMap(({ id }) => (id ? [id] : []))
      ),
      noticedFailureCycles: new Set(failures.map((f) => f.cycle)),
      authorisationWindowMs: 24 * 60 * 60 * 1000,
    });
    const fcraEnabled = await readSetting(tx, "org.fcraEnabled");
    for (const charge of plan.record) {
      const decision = decideDonationPayments(
        { status: "pending", amountMinor: row.amountMinor },
        [
          {
            id: charge.paymentId,
            orderId: subscriptionId,
            status: "captured",
            amountMinor: charge.amountMinor,
            currency: charge.currency,
            international: charge.international,
          },
        ],
        { orderId: subscriptionId, knownPaymentIds: [], fcraEnabled }
      );
      if (decision.capture) await recordCharge(tx, ctx, row, charge);
      else if (decision.refundForeign.length)
        await refuseCharge(tx, ctx, row, charge, "foreign_payment");
      else
        await recurringAudit(tx, ctx, row.id, "conflict", null, {
          gatewayPaymentId: charge.paymentId,
          reason: "amount_or_currency_mismatch",
        });
    }
    for (const charge of plan.refundAfterCancel) {
      if (charge.currency !== "INR")
        await recurringAudit(tx, ctx, row.id, "conflict", null, {
          gatewayPaymentId: charge.paymentId,
          reason: "late_non_inr",
        });
      else await refuseCharge(tx, ctx, row, charge, "recurring_after_cancel");
    }
    if (plan.conflict)
      await recurringAudit(
        tx,
        ctx,
        row.id,
        "conflict",
        { status: row.status },
        { remoteStatus: plan.conflict.remoteStatus }
      );
    if (plan.move) {
      const { from, to } = plan.move;
      const activated = from === "pending_authorisation" && to === "active";
      await recurringAudit(
        tx,
        ctx,
        row.id,
        activated
          ? "activated"
          : to === "cancelled"
            ? "cancelled"
            : to === "halted"
              ? "halted"
              : "status_changed",
        { status: from },
        { status: to }
      );
      if (activated || to === "cancelled")
        await emit(tx, ctx.clock, {
          type: activated
            ? "recurring_donation.activated"
            : "recurring_donation.cancelled",
          aggregate: { type: "recurring_donation", id: row.id },
          payload: { id: row.id },
        });
    }
    if (plan.failureNotice) {
      await tx.insert(recurringChargeFailure).values({
        recurringDonationId: row.id,
        cycleKey: plan.failureNotice.cycleKey,
        notifiedAt: now,
      });
      await emit(tx, ctx.clock, {
        type: "recurring_donation.charge_failed",
        aggregate: { type: "recurring_donation", id: row.id },
        payload: { id: row.id },
      });
    }
    if (
      plan.move ||
      (!plan.conflict &&
        (row.nextChargeAt?.getTime() ?? null) !==
          (plan.nextChargeAt?.getTime() ?? null))
    ) {
      await tx
        .update(recurringDonation)
        .set({
          status: plan.status,
          nextChargeAt: plan.nextChargeAt,
          updatedAt: now,
          ...(plan.status === "cancelled"
            ? {
                cancelledAt: remote.endedAt ?? now,
                cancelledBy: row.cancelRequestedBy ?? ("provider" as const),
              }
            : {}),
        })
        .where(eq(recurringDonation.id, row.id));
    }
    return plan.status;
  });
}

async function recordCharge(
  tx: AppDb,
  ctx: SyncContext,
  row: RecurringDonationRow,
  charge: RemoteCharge
) {
  const now = ctx.clock.now();
  const id = uuidv7(now);
  const [batch] = await tx
    .insert(paymentBatch)
    .values({
      id: uuidv7(now),
      purpose: "donation",
      status: "order_created",
      amountMinor: charge.amountMinor,
      currency: "INR",
      payerUserId: row.userId,
      gateway: row.gateway,
      gatewayOrderId: `subscription-charge:${charge.paymentId}`,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!batch) throw new Error("No recurring payment batch");
  const [made] = await tx
    .insert(donation)
    .values({
      id,
      donorId: row.donorId,
      recurringDonationId: row.id,
      origin: "recurring_charge",
      status: "pending",
      amountMinor: row.amountMinor,
      currency: "INR",
      paymentBatchId: batch.id,
      showOnWall: row.showOnWall,
      wallName: row.wallName,
      declaredAdult: true,
      declaredIndianSource: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!made) throw new Error("No recurring charge donation");
  await captureDonation(
    tx,
    ctx,
    {
      batch,
      row: made,
      gatewayPaymentId: charge.paymentId,
      capturedAt: charge.createdAt,
      event: "captured",
      batchEvent: "captured",
    },
    null
  );
}

async function refuseCharge(
  tx: AppDb,
  ctx: SyncContext,
  row: RecurringDonationRow,
  charge: RemoteCharge,
  kind: "foreign_payment" | "recurring_after_cancel"
) {
  const now = ctx.clock.now();
  const batchId = uuidv7(now);
  await tx.insert(paymentBatch).values({
    id: batchId,
    purpose: "donation",
    status: "order_created",
    amountMinor: charge.amountMinor,
    currency: "INR",
    payerUserId: row.userId,
    gateway: row.gateway,
    gatewayOrderId: `subscription-charge:${charge.paymentId}`,
    createdAt: now,
    updatedAt: now,
  });
  const refund = await startSystemRefund(tx, ctx, {
    kind,
    batchId,
    gatewayPaymentId: charge.paymentId,
    amountMinor: charge.amountMinor,
    reason:
      kind === "foreign_payment"
        ? "Foreign donation not accepted"
        : "Charge after recurring donation cancellation",
    idempotencyKey: `recurring-refusal:${charge.paymentId}`,
  });
  if (!("refundId" in refund))
    throw new Error("Recurring refund was not started");
  await tx.insert(recurringRefusedCharge).values({
    gatewayPaymentId: charge.paymentId,
    recurringDonationId: row.id,
    refundId: refund.refundId,
  });
  await emit(tx, ctx.clock, {
    type: "recurring_donation.payment_refused",
    aggregate: { type: "recurring_donation", id: row.id },
    payload: { id: row.id, refundId: refund.refundId },
  });
}
