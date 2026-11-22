// The refund rows the refund use cases share (#80): what a batch has left
// to refund, locking a refund, letting its items go, and what a refunded
// refund does to its registrations. Not use cases: callers have authorised
// their actor and pass their transaction.
//
// Loads under plain Node (the worker, the seed script): relative imports
// only, no "server-only".

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { Role } from "../../../access/domain/roles";
import type { Actor } from "../../../actor";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import {
  paymentBatchItem,
  refund,
  refundItem,
  registration,
  type RefundRow,
} from "../../../db/schema";
import type { Clock } from "../../../ports/clock";
import { canTransition } from "../../registration/domain/registration-status";
import { characterCount } from "../domain/review-case";
import type { ItemRefundState } from "../domain/refund-plan";

type AuditContext = { clock: Clock; actor: Actor };

/** A reason or a note: 1 to 500 characters, as a reader counts them. */
export const REFUND_TEXT_MAX_LENGTH = 500;

/** The text trimmed, or why it can't be stored. */
export function checkRefundText(
  raw: string,
  { required }: { required: boolean }
): { ok: true; text: string | null } | { ok: false; error: "required" | "too_long" } {
  const text = raw.trim();
  if (text === "") {
    return required ? { ok: false, error: "required" } : { ok: true, text: null };
  }
  if (characterCount(text) > REFUND_TEXT_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  return { ok: true, text };
}

/**
 * Every registration the batch holds, with the fee it was charged and
 * where it stands with refunds: free, held by a live refund, or refunded.
 */
export async function refundableItems(
  db: AppDb,
  batchId: string
): Promise<{ id: string; amountMinor: bigint; refund: ItemRefundState }[]> {
  const items = await db
    .select({
      id: paymentBatchItem.registrationId,
      amountMinor: paymentBatchItem.amountMinor,
    })
    .from(paymentBatchItem)
    .where(
      and(
        eq(paymentBatchItem.batchId, batchId),
        isNull(paymentBatchItem.releasedAt)
      )
    )
    .orderBy(asc(paymentBatchItem.registrationId));
  const held = await db
    .select({
      registrationId: refundItem.registrationId,
      status: refund.status,
    })
    .from(refundItem)
    .innerJoin(refund, eq(refund.id, refundItem.refundId))
    .where(and(eq(refundItem.batchId, batchId), isNull(refundItem.releasedAt)));
  const stateOf = new Map(
    held.map((row) => [
      row.registrationId,
      row.status === "refunded" ? ("refunded" as const) : ("live" as const),
    ])
  );
  return items.map((item) => ({
    ...item,
    refund: stateOf.get(item.id) ?? "none",
  }));
}

/** The refund, locked until the transaction ends; null if there is none. */
export async function lockRefund(
  db: AppDb,
  refundId: string
): Promise<RefundRow | null> {
  const [row] = await db
    .select()
    .from(refund)
    .where(eq(refund.id, refundId))
    .for("update");
  return row ?? null;
}

/** Lets the refund's items go, so another refund may list them. */
export async function releaseItems(
  tx: AppDb,
  refundId: string,
  at: Date
): Promise<void> {
  await tx
    .update(refundItem)
    .set({ releasedAt: at })
    .where(and(eq(refundItem.refundId, refundId), isNull(refundItem.releasedAt)));
}

/**
 * Marks the refund's confirmed registrations refunded, once its money is
 * back. A student withdrawn before the capture stays withdrawn: their fee
 * goes back, but they were never registered. Returns how many moved.
 */
export async function refundRegistrations(
  tx: AppDb,
  refundId: string,
  at: Date
): Promise<string[]> {
  const rows = await tx
    .select({ id: registration.id, status: registration.status })
    .from(refundItem)
    .innerJoin(registration, eq(registration.id, refundItem.registrationId))
    .where(and(eq(refundItem.refundId, refundId), isNull(refundItem.releasedAt)))
    .orderBy(asc(registration.id))
    .for("update", { of: registration });
  const moving = rows
    .filter((row) => canTransition(row.status, "refunded", "payment"))
    .map((row) => row.id);
  if (moving.length > 0) {
    await tx
      .update(registration)
      .set({ status: "refunded", updatedAt: at })
      .where(inArray(registration.id, moving));
  }
  return moving;
}

/** One audit entry about a refund. Ids and amounts only: no names. */
export async function auditRefund(
  tx: AppDb,
  ctx: AuditContext,
  refundId: string,
  entry: { action: `refund.${string}`; before: unknown; after: unknown },
  actorRole: Role | null
): Promise<void> {
  await recordAudit(tx, ctx, {
    action: entry.action,
    entity: { type: "refund", id: refundId },
    before: entry.before,
    after: entry.after,
    actorRole,
  });
}
