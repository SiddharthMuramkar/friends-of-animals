// The refunds the system approves itself (#80), never through `as(actor)`:
//
// - startSystemRefund: a cancellation (80b: the competition was cancelled,
//   so every paid fee goes back) refunds what a batch has left; a duplicate
//   (a payment in review resolved with a refund, #79) refunds that payment
//   in full and lists no students. Either is approved at once, with no
//   approver, and goes out through the same funnel as finance's approvals
//   (refund.approved → refunds.send). Its idempotency key makes it safe to
//   call again: the refund the first call made is returned.
// - supersedeRequestedRefunds: a cancellation takes over requests still
//   waiting for finance, rejecting them so their students are free for the
//   cancellation's refund.
//
// Both run in the caller's transaction, after the caller has authorised
// its actor; they write audit entries as that actor.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, inArray } from "drizzle-orm";

import type { Role } from "../../../access/domain/roles";
import type { Actor } from "../../../actor";
import type { AppDb } from "../../../db/app-db";
import { refund, refundItem } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import type { Clock } from "../../../ports/clock";
import { lockBatch } from "../batches";
import { planRefund } from "../domain/refund-plan";
import { initialRefundStatus } from "../domain/refund-status";
import { queueSend, rejectLocked } from "./decide-refund";
import { auditRefund, lockRefund, refundableBatch } from "./rows";

type SystemContext = { clock: Clock; actor: Actor };

export type SystemRefund =
  | {
      kind: "cancellation";
      batchId: string;
      /** Leave out for every student the batch has left. */
      registrationIds?: string[];
      reason: string;
      idempotencyKey: string;
      actorRole?: Role | null;
    }
  | {
      kind: "duplicate";
      batchId: string;
      /** The review case it settles (#79). */
      reviewCaseId: string;
      /** The payment refunded in full; null for one paid offline. */
      gatewayPaymentId: string | null;
      amountMinor: bigint;
      reason: string;
      idempotencyKey: string;
      actorRole?: Role | null;
    };

export async function startSystemRefund(
  tx: AppDb,
  ctx: SystemContext,
  request: SystemRefund
): Promise<{ refundId: string } | { skipped: "nothing_to_refund" }> {
  const [earlier] = await tx
    .select({ id: refund.id })
    .from(refund)
    .where(eq(refund.idempotencyKey, request.idempotencyKey));
  if (earlier) return { refundId: earlier.id };

  const batch = await lockBatch(tx, request.batchId);
  if (!batch) throw new Error(`No batch ${request.batchId}`);
  const now = ctx.clock.now();
  const refundId = uuidv7(now);
  const status = initialRefundStatus(request.kind);

  let amountMinor: bigint;
  let gatewayPaymentId: string | null;
  let items: { registrationId: string; amountMinor: bigint }[] = [];
  if (request.kind === "duplicate") {
    amountMinor = request.amountMinor;
    gatewayPaymentId = request.gatewayPaymentId;
  } else {
    const available = await refundableBatch(tx, batch);
    if (available.kind === "dashboard") return { skipped: "nothing_to_refund" };
    const plan = planRefund(available, request);
    if (!plan.ok) return { skipped: "nothing_to_refund" };
    const allocated = new Map(
      available.items.map((item) => [item.id, item.amountMinor])
    );
    items = plan.registrationIds.map((registrationId) => ({
      registrationId,
      amountMinor: allocated.get(registrationId)!,
    }));
    amountMinor = plan.amountMinor;
    gatewayPaymentId =
      batch.captureMethod === "offline" ? null : batch.gatewayPaymentId;
  }
  const method = gatewayPaymentId === null ? "manual" : "gateway";

  const [made] = await tx
    .insert(refund)
    .values({
      id: refundId,
      batchId: batch.id,
      reviewCaseId: request.kind === "duplicate" ? request.reviewCaseId : null,
      gatewayPaymentId,
      kind: request.kind,
      status,
      method,
      amountMinor,
      currency: "INR",
      reason: request.reason.trim(),
      requestedAt: now,
      decidedAt: now,
      idempotencyKey: request.idempotencyKey,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: refund.idempotencyKey })
    .returning({ id: refund.id });
  if (!made) {
    const [raced] = await tx
      .select({ id: refund.id })
      .from(refund)
      .where(eq(refund.idempotencyKey, request.idempotencyKey));
    if (!raced) throw new Error("A system refund vanished");
    return { refundId: raced.id };
  }
  if (items.length > 0) {
    await tx
      .insert(refundItem)
      .values(items.map((item) => ({ ...item, refundId, batchId: batch.id })));
  }
  await auditRefund(
    tx,
    ctx,
    refundId,
    {
      action: "refund.approved",
      before: null,
      after: {
        batchId: batch.id,
        kind: request.kind,
        status,
        method,
        amountMinor: amountMinor.toString(),
        registrationIds: items.map((item) => item.registrationId),
        ...(request.kind === "duplicate"
          ? { reviewCaseId: request.reviewCaseId }
          : {}),
      },
    },
    request.actorRole ?? null
  );
  await queueSend(tx, ctx, { id: refundId, method });
  return { refundId };
}

/**
 * Rejects the requests still waiting for finance on `batchIds`, freeing
 * their students. Returns the refunds it rejected.
 */
export async function supersedeRequestedRefunds(
  tx: AppDb,
  ctx: SystemContext,
  {
    batchIds,
    reason,
    actorRole = null,
  }: { batchIds: string[]; reason: string; actorRole?: Role | null }
): Promise<string[]> {
  if (batchIds.length === 0) return [];
  const waiting = await tx
    .select({ id: refund.id })
    .from(refund)
    .where(
      and(inArray(refund.batchId, batchIds), eq(refund.status, "requested"))
    )
    .orderBy(refund.id);
  const superseded: string[] = [];
  for (const { id } of waiting) {
    const row = await lockRefund(tx, id);
    if (!row || row.status !== "requested") continue;
    await rejectLocked(tx, ctx, row, {
      decidedBy: null,
      note: reason.trim(),
      role: actorRole,
    });
    superseded.push(id);
  }
  return superseded;
}
