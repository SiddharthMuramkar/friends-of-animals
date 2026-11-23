// The refund rows the refund use cases share (#80): what a batch has left
// to refund, locking a refund, letting its items go, and what a refunded
// refund does to its registrations. Not use cases: callers have authorised
// their actor and pass their transaction.
//
// Loads under plain Node (the worker, the seed script): relative imports
// only, no "server-only".

import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { Role } from "../../../access/domain/roles";
import type { Actor } from "../../../actor";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import {
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  refund,
  refundItem,
  registration,
  type PaymentBatchRow,
  type RefundRow,
} from "../../../db/schema";
import type { Clock } from "../../../ports/clock";
import { canTransition } from "../../registration/domain/registration-status";
import { characterCount } from "../domain/review-case";
import {
  allocateRefundItems,
  type RefundableBatch,
} from "../domain/refund-plan";

type AuditContext = { clock: Clock; actor: Actor };

/** A reason or a note: 1 to 500 characters, as a reader counts them. */
export const REFUND_TEXT_MAX_LENGTH = 500;

/** The text trimmed, or why it can't be stored. */
export function checkRefundText(
  raw: string,
  { required }: { required: boolean }
):
  | { ok: true; text: string | null }
  | { ok: false; error: "required" | "too_long" } {
  const text = raw.trim();
  if (text === "") {
    return required
      ? { ok: false, error: "required" }
      : { ok: true, text: null };
  }
  if (characterCount(text) > REFUND_TEXT_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  return { ok: true, text };
}

/** The receipt accepted by finance, including captures confirmed before #80b. */
export const acceptedReviewOfBatch = and(
  eq(paymentReviewCase.batchId, paymentBatch.id),
  eq(paymentReviewCase.gatewayPaymentId, paymentBatch.gatewayPaymentId),
  eq(paymentReviewCase.outcome, "confirm"),
  eq(paymentBatch.status, "captured")
);

type RefundableCapture =
  | (RefundableBatch & { kind: "inr" })
  | (Pick<RefundableBatch, "amountMinor" | "items"> & {
      kind: "dashboard";
      currency: string;
      reviewCaseId: string;
      state: "review" | "required" | "recorded";
    });

/** The refundable amount and allocation for every registration the batch holds. */
export async function refundableBatch(
  db: AppDb,
  batch: Pick<PaymentBatchRow, "id" | "status" | "amountMinor">
): Promise<RefundableCapture> {
  const captured = batch.status === "captured";
  const [receipt] = captured
    ? await db
        .select({
          id: paymentReviewCase.id,
          amountMinor: paymentReviewCase.amountMinor,
          currency: paymentReviewCase.currency,
          refundDue: paymentReviewCase.refundDue,
          dashboardRefundReference: paymentReviewCase.dashboardRefundReference,
        })
        .from(paymentBatch)
        .innerJoin(paymentReviewCase, acceptedReviewOfBatch)
        .where(eq(paymentBatch.id, batch.id))
    : [];
  const amountMinor = receipt?.amountMinor ?? batch.amountMinor;
  const dashboard = receipt && receipt.currency !== "INR" ? receipt : null;
  const items = await db
    .select({
      id: paymentBatchItem.registrationId,
      amountMinor: paymentBatchItem.amountMinor,
    })
    .from(paymentBatchItem)
    .where(
      and(
        eq(paymentBatchItem.batchId, batch.id),
        isNull(paymentBatchItem.releasedAt)
      )
    )
    .orderBy(asc(paymentBatchItem.registrationId));
  const againstCapture = or(
    eq(refund.gatewayPaymentId, paymentBatch.gatewayPaymentId),
    and(
      eq(paymentBatch.captureMethod, "offline"),
      eq(refund.method, "manual"),
      ne(refund.kind, "duplicate")
    )
  );
  // Use one snapshot for holds and committed amounts. A concurrent rejection
  // releases both together, so the allocation must observe both or neither.
  const commitments = await db
    .select({
      id: refund.id,
      status: refund.status,
      amountMinor: refund.amountMinor,
      againstCapture: sql<boolean>`coalesce(${againstCapture}, false)`,
      held: {
        registrationId: refundItem.registrationId,
        amountMinor: refundItem.amountMinor,
      },
    })
    .from(refund)
    .innerJoin(paymentBatch, eq(paymentBatch.id, refund.batchId))
    .leftJoin(
      refundItem,
      and(
        eq(refundItem.refundId, refund.id),
        eq(refundItem.batchId, refund.batchId),
        isNull(refundItem.releasedAt)
      )
    )
    .where(eq(refund.batchId, batch.id));
  const holds = new Map<
    string,
    { amountMinor: bigint; status: RefundRow["status"] }
  >();
  const counted = new Set<string>();
  let committedMinor = 0n;
  for (const row of commitments) {
    if (row.held) {
      holds.set(row.held.registrationId, {
        amountMinor: row.held.amountMinor,
        status: row.status,
      });
    }
    if (
      row.againstCapture &&
      row.status !== "rejected" &&
      !counted.has(row.id)
    ) {
      committedMinor += row.amountMinor;
      counted.add(row.id);
    }
  }
  const allocations = items.map((item) => ({
    ...item,
    heldMinor: holds.get(item.id)?.amountMinor ?? null,
  }));
  const shares =
    receipt && !dashboard
      ? allocateRefundItems(amountMinor - committedMinor, allocations)
      : null;
  const allocatedItems: RefundableBatch["items"] = allocations.map(
    ({ id, amountMinor, heldMinor }, index) => ({
      id,
      amountMinor: dashboard
        ? 0n
        : (shares?.[index] ?? heldMinor ?? amountMinor),
      refund:
        heldMinor === null
          ? "none"
          : holds.get(id)?.status === "refunded"
            ? "refunded"
            : "live",
    })
  );
  if (dashboard) {
    return {
      kind: "dashboard",
      amountMinor,
      currency: dashboard.currency,
      reviewCaseId: dashboard.id,
      state: dashboard.dashboardRefundReference
        ? "recorded"
        : dashboard.refundDue
          ? "required"
          : "review",
      items: allocatedItems,
    };
  }
  return {
    kind: "inr",
    captured,
    amountMinor,
    committedMinor,
    currency: "INR",
    items: allocatedItems,
  };
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
    .where(
      and(eq(refundItem.refundId, refundId), isNull(refundItem.releasedAt))
    );
}

/**
 * Marks the refund's confirmed registrations refunded, once its money is
 * back. A student withdrawn before the capture stays withdrawn: their fee
 * goes back, but they were never registered. Returns how many moved.
 */
export async function refundRegistrations(
  tx: AppDb,
  source: { refundId: string } | { batchId: string },
  at: Date
): Promise<string[]> {
  const items =
    "refundId" in source
      ? tx
          .select({ id: refundItem.registrationId })
          .from(refundItem)
          .where(
            and(
              eq(refundItem.refundId, source.refundId),
              isNull(refundItem.releasedAt)
            )
          )
      : tx
          .select({ id: paymentBatchItem.registrationId })
          .from(paymentBatchItem)
          .where(
            and(
              eq(paymentBatchItem.batchId, source.batchId),
              isNull(paymentBatchItem.releasedAt)
            )
          );
  const rows = await tx
    .select({ id: registration.id, status: registration.status })
    .from(registration)
    .where(inArray(registration.id, items))
    .orderBy(asc(registration.id))
    .for("update");
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
