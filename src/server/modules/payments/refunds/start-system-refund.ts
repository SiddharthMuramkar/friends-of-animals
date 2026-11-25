// The refunds the system approves itself (#80), never through `as(actor)`:
//
// - startSystemRefund: a donation's foreign payment (#106) refunds that
//   payment in full while FCRA is off, with no students and no case;
//   a cancellation (80b: the competition was cancelled,
//   so every paid fee goes back) refunds what a batch has left; a duplicate
//   (a payment in review resolved with a refund, #79) refunds that payment
//   in full and lists no students. Either is approved at once, with no
//   approver, and goes out through the same funnel as finance's approvals
//   (refund.approved → refunds.send). Its idempotency key makes it safe to
//   call again: the refund the first call made is returned.
// - supersedeDiscretionaryRefunds: a cancellation takes over requests
//   awaiting finance and definitively failed attempts, rejecting them so
//   their students are free for the cancellation's refund.
// - lockRefundsForCancellation: a cancellation and a settlement lock a
//   batch's refunds in the same order, after the batch.
//
// They run in the caller's transaction, after the caller has authorised
// its actor; they write audit entries as that actor.
//
// Loads under plain Node (the worker): relative imports only.

import { eq, inArray } from "drizzle-orm";

import type { Role } from "../../../access/domain/roles";
import type { Actor } from "../../../actor";
import type { AppDb } from "../../../db/app-db";
import { refund, refundItem } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import type { Clock } from "../../../ports/clock";
import { lockBatch } from "../batches";
import { planRefund, splitRefundCoverage } from "../domain/refund-plan";
import {
  canSupersedeForCancellation,
  initialRefundStatus,
  SUPERSEDED_BY_CANCELLATION,
} from "../domain/refund-status";
import { queueSend, rejectLocked } from "./decide-refund";
import { auditRefund, refundableBatch } from "./rows";

type SystemContext = { clock: Clock; actor: Actor };

export type SystemRefund =
  | {
      kind: "cancellation";
      batchId: string;
      /** Leave out for every student the batch has left. */
      registrationIds?: string[];
      /**
       * The cancellation's balance, including any amount no student's share
       * holds. The refund is skipped unless it is exactly what the capture
       * has left; with an empty `registrationIds` it lists no students.
       */
      expectedAmountMinor?: bigint;
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
    }
  | {
      /** A donation's foreign payment (#106), refunded in full at once
       * while FCRA is off. It settles no review case. */
      kind: "foreign_payment";
      batchId: string;
      gatewayPaymentId: string;
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
  let registrationIds: string[] = [];
  let coverage: ReturnType<typeof splitRefundCoverage> = {
    payableItems: [],
    zeroShareRegistrationIds: [],
  };
  if (request.kind === "duplicate" || request.kind === "foreign_payment") {
    amountMinor = request.amountMinor;
    gatewayPaymentId = request.gatewayPaymentId;
  } else {
    const available = await refundableBatch(tx, batch);
    if (available.kind === "dashboard") return { skipped: "nothing_to_refund" };
    const expected = request.expectedAmountMinor;
    if (
      expected !== undefined &&
      (!available.captured ||
        expected <= 0n ||
        expected !== available.amountMinor - available.committedMinor)
    ) {
      return { skipped: "nothing_to_refund" };
    }
    if (expected !== undefined && request.registrationIds?.length === 0) {
      amountMinor = expected;
    } else {
      const plan = planRefund(available, request);
      if (!plan.ok) return { skipped: "nothing_to_refund" };
      registrationIds = plan.registrationIds;
      coverage = splitRefundCoverage(available.items, registrationIds);
      amountMinor = expected ?? plan.amountMinor;
    }
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
      zeroShareRegistrationIds: coverage.zeroShareRegistrationIds,
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
  const items = coverage.payableItems.map((item) => ({
    ...item,
    refundId,
    batchId: batch.id,
  }));
  if (items.length > 0) {
    await tx.insert(refundItem).values(items);
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
        registrationIds,
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
 * Locks a batch's refunds after the batch and before any registrations.
 * Settlement takes its refund lock before locking registrations too.
 */
export async function lockRefundsForCancellation(
  tx: AppDb,
  batchIds: string[]
): Promise<void> {
  if (batchIds.length === 0) return;
  await tx
    .select({ id: refund.id })
    .from(refund)
    .where(inArray(refund.batchId, batchIds))
    .orderBy(refund.id)
    .for("update");
}

/**
 * Rejects the locked discretionary refunds the cancellation takes over,
 * freeing their students. Returns the refunds it rejected.
 */
export async function supersedeDiscretionaryRefunds(
  tx: AppDb,
  ctx: SystemContext,
  refundIds: string[],
  actorRole: Role | null = null
): Promise<string[]> {
  if (refundIds.length === 0) return [];
  const prior = await tx
    .select()
    .from(refund)
    .where(inArray(refund.id, refundIds))
    .orderBy(refund.id)
    .for("update");
  if (
    prior.length !== new Set(refundIds).size ||
    prior.some((row) => !canSupersedeForCancellation(row))
  ) {
    throw new Error("A refund planned for supersession is no longer eligible");
  }
  for (const row of prior) {
    await rejectLocked(tx, ctx, row, {
      decidedBy: null,
      note: SUPERSEDED_BY_CANCELLATION,
      role: actorRole,
    });
  }
  return prior.map((row) => row.id);
}
