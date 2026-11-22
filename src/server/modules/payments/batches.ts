// The payment batch rows the payment use cases share (#77): which
// registrations are waiting to be paid, the batch that holds them, and the
// moves that let a batch's registrations go. Not use cases: callers have
// authorised their actor and pass their transaction.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  paymentBatch,
  paymentBatchItem,
  registration,
  type PaymentBatchRow,
} from "../../db/schema";
import type { Clock } from "../../ports/clock";
import {
  nextPaymentBatchStatus,
  type PaymentBatchEvent,
} from "./domain/batch-status";

type AuditContext = { clock: Clock; actor: Actor };

/**
 * The registrations of an institution registration that still wait for
 * their fee: enrolled, not yet confirmed, in id order.
 */
export async function payableRegistrations(
  db: AppDb,
  institutionRegistrationId: string
): Promise<string[]> {
  const rows = await db
    .select({ id: registration.id })
    .from(registration)
    .where(
      and(
        eq(registration.institutionRegistrationId, institutionRegistrationId),
        eq(registration.status, "enrolled")
      )
    )
    .orderBy(asc(registration.id));
  return rows.map((row) => row.id);
}

/**
 * The institution registration's batch that is still waiting for its
 * order or its payment, if any: there is at most one, since a new batch
 * replaces the old one.
 */
export async function openBatchOf(
  db: AppDb,
  institutionRegistrationId: string
): Promise<PaymentBatchRow | null> {
  const [row] = await db
    .select()
    .from(paymentBatch)
    .where(
      and(
        eq(paymentBatch.institutionRegistrationId, institutionRegistrationId),
        inArray(paymentBatch.status, ["created", "order_created"])
      )
    )
    .orderBy(asc(paymentBatch.createdAt))
    .for("update");
  return row ?? null;
}

/** The batch, locked until the transaction ends; null if there is none. */
export async function lockBatch(
  db: AppDb,
  batchId: string
): Promise<PaymentBatchRow | null> {
  const [row] = await db
    .select()
    .from(paymentBatch)
    .where(eq(paymentBatch.id, batchId))
    .for("update");
  return row ?? null;
}

/** The registrations a batch holds now, with what each was charged. */
export async function heldItems(
  db: AppDb,
  batchId: string
): Promise<{ registrationId: string; amountMinor: bigint }[]> {
  return db
    .select({
      registrationId: paymentBatchItem.registrationId,
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
}

/**
 * Ends a batch that was never paid: replaced by a newer one (`superseded`)
 * or refused by the gateway (`order_refused`). Its registrations are let
 * go, so another batch may hold them. Returns false, changing nothing, if
 * the machine forbids the move.
 */
export async function endUnpaidBatch(
  tx: AppDb,
  ctx: AuditContext,
  batch: PaymentBatchRow,
  event: Extract<PaymentBatchEvent, "superseded" | "order_refused">,
  actorRole: Role | null
): Promise<boolean> {
  const move = nextPaymentBatchStatus(batch.status, event);
  if (!move.ok) return false;
  const now = ctx.clock.now();
  await tx
    .update(paymentBatch)
    .set({ status: move.to, updatedAt: now })
    .where(eq(paymentBatch.id, batch.id));
  await tx
    .update(paymentBatchItem)
    .set({ releasedAt: now })
    .where(
      and(
        eq(paymentBatchItem.batchId, batch.id),
        isNull(paymentBatchItem.releasedAt)
      )
    );
  await recordAudit(tx, ctx, {
    action:
      event === "superseded"
        ? "payment.batch_cancelled"
        : "payment.order_refused",
    entity: { type: "payment_batch", id: batch.id },
    before: { status: batch.status },
    after: { status: move.to },
    actorRole,
  });
  return true;
}
