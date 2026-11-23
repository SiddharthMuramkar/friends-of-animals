// The capture path (#77, #79): the one way a batch becomes paid, whether
// the gateway captured its order (./sync-batch.ts), finance recorded an
// offline payment (./record-offline-payment.ts) or staff accepted money
// that was in review (./resolve-review-case.ts). So "the same effect as an
// online capture" holds by construction: the batch is captured, every
// registration it holds is confirmed with its number, and the receipt and
// confirmations go to the outbox, all in the caller's transaction.
//
// Also what a capture decision reads about the batch's registrations, for
// `reviewReasonFor` (./domain/review-case.ts).
//
// Not use cases: callers have authorised their actor, locked the batch and
// pass their transaction. Loads under plain Node: relative imports only.

import { and, asc, eq } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionKeyDate,
  paymentBatch,
  paymentBatchItem,
  registration,
  type PaymentBatchRow,
} from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { registrationWindow } from "../registration/domain/registration-window";
import { confirmRegistrations } from "../registration/confirm";
import type { RegistrationStatus } from "../registration/domain/registration-status";
import { heldItems } from "./batches";
import {
  nextPaymentBatchStatus,
  type PaymentCaptureMethod,
} from "./domain/batch-status";
import type { RegistrationAtCapture } from "./domain/review-case";

type CaptureContext = Pick<
  UseCaseContext,
  "appEnv" | "clock" | "actor" | "cipher"
>;

export type CaptureHow = {
  event: "captured" | "offline_recorded" | "review_confirmed";
  method: PaymentCaptureMethod;
  /** The gateway payment it was captured with; null when paid offline. */
  gatewayPaymentId: string | null;
};

/**
 * Captures `batch` (locked by the caller) and confirms every registration
 * it holds. Missing participation consent leaves the batch and registrations
 * as they were. Callers check the batch transition first.
 */
export async function captureBatch(
  tx: AppDb,
  ctx: CaptureContext,
  batch: PaymentBatchRow,
  how: CaptureHow,
  actorRole: Role | null
): Promise<
  | { ok: true; confirmed: number; refused: string[] }
  | { ok: false; error: "participation_consent_required" }
> {
  const move = nextPaymentBatchStatus(batch.status, how.event);
  if (!move.ok) throw new Error(`Batch ${batch.id} can't be captured`);
  const [target] = await tx
    .select({ code: competition.code })
    .from(competition)
    .where(eq(competition.id, batch.competitionId));
  if (!target) throw new Error(`Batch ${batch.id} has no competition`);
  const held = await heldItems(tx, batch.id);
  const { confirmed, refused, error } = await confirmRegistrations(tx, ctx, {
    registrationIds: held.map((item) => item.registrationId),
    competitionCode: target.code,
    batchId: batch.id,
    actorRole,
  });
  if (error) return { ok: false, error };

  const now = ctx.clock.now();
  await tx
    .update(paymentBatch)
    .set({
      status: move.to,
      captureMethod: how.method,
      gatewayPaymentId: how.gatewayPaymentId,
      capturedAt: now,
      updatedAt: now,
    })
    .where(eq(paymentBatch.id, batch.id));
  const entity = { type: "payment_batch" as const, id: batch.id };
  await recordAudit(tx, ctx, {
    action: "payment.batch_captured",
    entity,
    before: { status: batch.status },
    after: {
      status: move.to,
      captureMethod: how.method,
      gatewayPaymentId: how.gatewayPaymentId,
      capturedAt: now.toISOString(),
      confirmed: confirmed.length,
      // Withdrawn after the order opened: paid for, but not confirmed.
      // Refunds (#80) settle them.
      notConfirmed: refused,
    },
    actorRole,
  });
  await emit(tx, ctx.clock, {
    type: "payment.batch_captured",
    aggregate: entity,
    payload: { batchId: batch.id, payerUserId: batch.payerUserId },
  });
  return {
    ok: true,
    confirmed: confirmed.length,
    refused: refused.map((each) => each.registrationId),
  };
}

/** How a registration's status reads to a capture. */
function standingOf(
  status: RegistrationStatus
): RegistrationAtCapture["standing"] {
  switch (status) {
    case "enrolled":
    case "pending_payment":
      return "awaiting_payment";
    case "confirmed":
      return "paid";
    default:
      // Withdrawn, and any status added later: not payable.
      return "cancelled";
  }
}

/**
 * Every registration the batch was made for (held now or let go), as a
 * capture at the clock's instant would find it.
 */
export async function registrationsAtCapture(
  db: AppDb,
  ctx: Pick<UseCaseContext, "clock">,
  batch: Pick<PaymentBatchRow, "id" | "competitionId">
): Promise<RegistrationAtCapture[]> {
  const rows = await db
    .select({
      registrationId: paymentBatchItem.registrationId,
      releasedAt: paymentBatchItem.releasedAt,
      status: registration.status,
    })
    .from(paymentBatchItem)
    .innerJoin(
      registration,
      eq(registration.id, paymentBatchItem.registrationId)
    )
    .where(eq(paymentBatchItem.batchId, batch.id))
    .orderBy(asc(paymentBatchItem.registrationId));
  const [target] = await db
    .select({ status: competition.status })
    .from(competition)
    .where(eq(competition.id, batch.competitionId));
  const [closes] = await db
    .select({ at: competitionKeyDate.at })
    .from(competitionKeyDate)
    .where(
      and(
        eq(competitionKeyDate.competitionId, batch.competitionId),
        eq(competitionKeyDate.kind, "registration_closes")
      )
    );
  const windowOpen =
    target !== undefined &&
    registrationWindow(
      { status: target.status, registrationClosesAt: closes?.at ?? null },
      ctx.clock.now()
    ) === "open";
  return rows.map((row) => ({
    registrationId: row.registrationId,
    standing: standingOf(row.status),
    windowOpen,
    heldByThisBatch: row.releasedAt === null,
  }));
}
