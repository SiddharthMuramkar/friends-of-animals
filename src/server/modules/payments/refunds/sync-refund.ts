// syncRefund(deps, refundId) (#80): the one path by which a refund reaches
// the gateway and learns what became of it. Every signal (approval and a
// system refund through the outbox's refunds.send, finance's retry, a
// refund webhook) only names the refund; this reads the payment's refunds
// back from the gateway, outside any transaction, and decides with the
// pure `decideRefundSync` (../domain/refund-sync.ts):
//
// - send: approved and unknown to the gateway, so it calls `refund` for
//   the refund's exact amount, with the idempotency key of this attempt
//   (the refund's id and attempt number) and notes naming both. A lost
//   answer is safe: the next run finds the gateway's refund by its notes
//   and adopts it instead of sending again, and the gateway itself returns
//   the first refund for a repeated key.
// - apply: in one transaction with the refund locked, the gateway's refund
//   moves ours: held (processing), processed (refunded: its registrations
//   are refunded, the payer is told) or failed (finance may retry). Each
//   move writes its audit entry and its events in the same transaction.
// - anything else changes nothing, and says why.
//
// Order and repetition don't matter: a refund moves forward only, and a
// signal that brings nothing new changes no row.
//
// Not a use case: the outbox handler, the webhook and the retry call it.
// Loads under plain Node (the worker): relative imports only.

import { and, eq, inArray, or } from "drizzle-orm";

import type { Role } from "../../../access/domain/roles";
import type { Actor } from "../../../actor";
import type { AppDb } from "../../../db/app-db";
import { paymentBatch, refund, type RefundRow } from "../../../db/schema";
import { emit } from "../../../outbox/emit";
import type { Clock } from "../../../ports/clock";
import type {
  GatewayRefund,
  PaymentGateway,
} from "../../../ports/payment-gateway";
import {
  decideRefundSync,
  refundIdempotencyKey,
  refundNotes,
  type RefundForSync,
} from "../domain/refund-sync";
import { nextRefundStatus, type RefundEvent } from "../domain/refund-status";
import { auditRefund, lockRefund, refundRegistrations } from "./rows";

export type RefundSyncDeps = {
  db: AppDb;
  clock: Clock;
  payments: PaymentGateway;
  /** Who the audit entries name: the worker, or the webhook's visitor. */
  actor: Actor;
};

export const REFUND_SYNC_OUTCOMES = [
  /** The gateway processed it: the money is back. */
  "refunded",
  /** The gateway holds it and hasn't finished. */
  "processing",
  /** The gateway gave up on it; finance may retry. */
  "failed",
  /** Nothing new: it was settled before, or isn't approved. */
  "unchanged",
  /** Approved, to be paid out by hand: finance records it. */
  "awaiting_manual",
  /** The gateway's refund is for another amount: never applied. */
  "amount_mismatch",
  /** Sent, but the gateway doesn't list it. */
  "missing_at_gateway",
  /** The batch was paid through another gateway than this one: only that
   * one may refund it. */
  "other_gateway",
] as const;

export type RefundSyncOutcome = (typeof REFUND_SYNC_OUTCOMES)[number];

function forSync(row: RefundRow): RefundForSync | null {
  if (row.method === "gateway" && row.gatewayPaymentId === null) return null;
  return {
    id: row.id,
    status: row.status,
    method: row.method,
    attempt: row.attempt,
    gatewayRefundId: row.gatewayRefundId,
    paymentId: row.gatewayPaymentId ?? "",
    amountMinor: row.amountMinor,
    currency: "INR",
  };
}

export async function syncRefund(
  deps: RefundSyncDeps,
  refundId: string,
  actorRole: Role | null = null
): Promise<RefundSyncOutcome> {
  const [found] = await deps.db
    .select()
    .from(refund)
    .where(eq(refund.id, refundId));
  const subject = found && forSync(found);
  if (!found || !subject) return "unchanged";
  if (found.status !== "approved" && found.status !== "processing") {
    return "unchanged";
  }
  if (found.method === "manual") return "awaiting_manual";
  // Only the gateway that took the payment can give it back.
  const [batch] = await deps.db
    .select({ gateway: paymentBatch.gateway })
    .from(paymentBatch)
    .where(eq(paymentBatch.id, found.batchId));
  if (batch?.gateway !== deps.payments.name) return "other_gateway";

  let atGateway: GatewayRefund[] = await deps.payments.fetchRefunds(
    subject.paymentId
  );
  if (decideRefundSync(subject, atGateway).kind === "send") {
    const sent = await deps.payments.refund({
      paymentId: subject.paymentId,
      amount: { amountMinor: subject.amountMinor, currency: "INR" },
      idempotencyKey: refundIdempotencyKey(subject),
      notes: refundNotes(subject),
    });
    atGateway = [sent, ...atGateway.filter((each) => each.id !== sent.id)];
  }

  return deps.db.transaction(async (tx): Promise<RefundSyncOutcome> => {
    const row = await lockRefund(tx, refundId);
    const locked = row && forSync(row);
    if (!row || !locked) return "unchanged";
    const decision = decideRefundSync(locked, atGateway);
    switch (decision.kind) {
      case "send":
        // Another run moved it on between the read and the lock, or the
        // gateway answered without listing what it made: try again later.
        return "missing_at_gateway";
      case "unchanged":
        return row.status === "processing" ? "processing" : "unchanged";
      case "awaiting_manual":
      case "amount_mismatch":
      case "missing_at_gateway":
        return decision.kind;
      case "apply":
        return apply(tx, deps, row, decision, actorRole);
    }
  });
}

async function apply(
  tx: AppDb,
  deps: RefundSyncDeps,
  row: RefundRow,
  decision: { event: RefundEvent; gatewayRefundId: string },
  actorRole: Role | null
): Promise<RefundSyncOutcome> {
  const now = deps.clock.now();
  let status = row.status;
  if (status === "approved") {
    // First sight of it at the gateway: it is sent.
    const held = nextRefundStatus(status, "sent");
    if (!held.ok) throw new Error(`Refund ${row.id} can't be sent`);
    await tx
      .update(refund)
      .set({
        status: held.to,
        gatewayRefundId: decision.gatewayRefundId,
        sentAt: now,
        updatedAt: now,
      })
      .where(eq(refund.id, row.id));
    await auditRefund(
      tx,
      deps,
      row.id,
      {
        action: "refund.sent",
        before: { status },
        after: {
          status: held.to,
          gatewayRefundId: decision.gatewayRefundId,
          attempt: row.attempt,
        },
      },
      actorRole
    );
    status = held.to;
  }
  if (decision.event === "sent") return "processing";

  const move = nextRefundStatus(status, decision.event);
  if (!move.ok) throw new Error(`Refund ${row.id} can't take ${decision.event}`);
  if (move.to === "refunded") {
    await tx
      .update(refund)
      .set({
        status: move.to,
        gatewayRefundId: decision.gatewayRefundId,
        refundedAt: now,
        updatedAt: now,
      })
      .where(eq(refund.id, row.id));
    await settleRefunded(tx, deps, row, status, actorRole);
    return "refunded";
  }
  await tx
    .update(refund)
    .set({ status: move.to, failedAt: now, updatedAt: now })
    .where(eq(refund.id, row.id));
  await auditRefund(
    tx,
    deps,
    row.id,
    {
      action: "refund.failed",
      before: { status },
      after: { status: move.to, gatewayRefundId: decision.gatewayRefundId },
    },
    actorRole
  );
  await emit(tx, deps.clock, {
    type: "refund.failed",
    aggregate: { type: "refund", id: row.id },
    payload: { refundId: row.id },
  });
  return "failed";
}

/**
 * What a refund reaching `refunded` does, in the transaction that marks
 * it: its registrations are refunded, the audit log says so, and the payer
 * is told (refund.processed). Also used by a manual refund.
 */
export async function settleRefunded(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  row: Pick<RefundRow, "id" | "batchId">,
  statusBefore: RefundRow["status"],
  actorRole: Role | null,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const now = ctx.clock.now();
  const registrationsRefunded = await refundRegistrations(tx, row.id, now);
  await auditRefund(
    tx,
    ctx,
    row.id,
    {
      action: "refund.refunded",
      before: { status: statusBefore },
      after: { status: "refunded", registrationsRefunded, ...extra },
    },
    actorRole
  );
  const [batch] = await tx
    .select({ payerUserId: paymentBatch.payerUserId })
    .from(paymentBatch)
    .where(eq(paymentBatch.id, row.batchId));
  await emit(tx, ctx.clock, {
    type: "refund.processed",
    aggregate: { type: "refund", id: row.id },
    payload: { refundId: row.id, payerUserId: batch?.payerUserId ?? null },
  });
}

/**
 * A refund webhook (#80): syncs each of our refunds it can be about, the
 * one the gateway named or any still open on that payment, as the
 * webhook's caller. Returns how many it synced.
 */
export async function syncRefundsOfPayment(
  ctx: Omit<RefundSyncDeps, "actor"> & { actor: Actor },
  named: { refundId: string; paymentId: string }
): Promise<number> {
  const rows = await ctx.db
    .select({ id: refund.id })
    .from(refund)
    .where(
      or(
        eq(refund.gatewayRefundId, named.refundId),
        and(
          eq(refund.gatewayPaymentId, named.paymentId),
          eq(refund.method, "gateway"),
          inArray(refund.status, ["approved", "processing"])
        )
      )
    )
    .orderBy(refund.id);
  for (const row of rows) {
    await syncRefund(ctx, row.id);
  }
  return rows.length;
}

/**
 * The outbox handler refunds.send: syncs the refund as the worker. A
 * refund the gateway answered for another amount, or lost, or one this
 * worker's gateway didn't take (its keys are missing), fails the delivery:
 * it is retried, then kept among the failed deliveries for staff.
 */
export async function sendApprovedRefund(
  deps: Omit<RefundSyncDeps, "actor">,
  { refundId }: { refundId: string }
): Promise<void> {
  const outcome = await syncRefund(
    { ...deps, actor: { kind: "system", process: "worker" } },
    refundId
  );
  if (
    outcome === "amount_mismatch" ||
    outcome === "missing_at_gateway" ||
    outcome === "other_gateway"
  ) {
    throw new Error(`Refund ${refundId}: ${outcome}`);
  }
}
