// retryRefund({ refundId }) and recordManualRefund({ refundId, method,
// reference }) (#80): finance's two ways of finishing an approved refund
// the gateway didn't, behind a second factor from the last 10 minutes.
//
// - retry: a refund the gateway failed is approved again as a new attempt,
//   with its own idempotency key (refund id and attempt number), and goes
//   out through the same funnel (refund.approved → refunds.send). Finance
//   may instead close it (rejectRefund), freeing its students.
// - record a manual refund: a batch paid offline (#79) is paid back by
//   hand. Finance records the method and its reference (the transfer's
//   UTR, the cheque number or the cash receipt, normalised as an offline
//   payment's is), and the refund is refunded at once: its registrations
//   are refunded and the payer is told, with no gateway call.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { refund } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import {
  normaliseOfflineReference,
  OFFLINE_PAYMENT_METHODS,
} from "../domain/offline-payment";
import { nextRefundStatus } from "../domain/refund-status";
import { retryLocked } from "./decide-refund";
import { lockRefund } from "./rows";
import { settleRefunded } from "./sync-refund";

export type RetryRefundInput = { refundId: string };

export type RetryRefundResult =
  | { ok: true; status: "approved" }
  | InvalidInput
  | { ok: false; error: "not_found" | "not_failed" };

export type RecordManualRefundInput = {
  refundId: string;
  /** cheque, bank_transfer or cash. */
  method: string;
  reference: string;
};

export type RecordManualRefundResult =
  | { ok: true; status: "refunded" }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "not_manual"
        | "not_approved"
        | "same_person"
        | "reference_invalid";
    };

const retryInput = z.strictObject({ refundId: z.uuid() });

const manualInput = z.strictObject({
  refundId: z.uuid(),
  method: z.enum(OFFLINE_PAYMENT_METHODS),
  reference: z.string().max(200),
});

export async function retryRefund(
  ctx: UseCaseContext,
  input: RetryRefundInput
): Promise<RetryRefundResult> {
  const { role } = await authorize(ctx, "refunds.decide");
  const parsed = retryInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  return ctx.db.transaction(async (tx): Promise<RetryRefundResult> => {
    const row = await lockRefund(tx, parsed.data.refundId);
    if (!row) return { ok: false, error: "not_found" };
    if (!nextRefundStatus(row.status, "retried").ok) {
      return { ok: false, error: "not_failed" };
    }
    await retryLocked(tx, ctx, row, role);
    return { ok: true, status: "approved" };
  });
}

export async function recordManualRefund(
  ctx: UseCaseContext,
  input: RecordManualRefundInput
): Promise<RecordManualRefundResult> {
  const { role } = await authorize(ctx, "refunds.decide");
  const parsed = manualInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const recordedBy = ctx.actor.userId;
  const { method } = parsed.data;
  const reference = normaliseOfflineReference(method, parsed.data.reference);

  return ctx.db.transaction(async (tx): Promise<RecordManualRefundResult> => {
    const row = await lockRefund(tx, parsed.data.refundId);
    if (!row) return { ok: false, error: "not_found" };
    if (row.method !== "manual") return { ok: false, error: "not_manual" };
    const move = nextRefundStatus(row.status, "processed");
    if (row.status !== "approved" || !move.ok) {
      return { ok: false, error: "not_approved" };
    }
    if (row.requestedBy === recordedBy)
      return { ok: false, error: "same_person" };
    if (!reference) return { ok: false, error: "reference_invalid" };
    const now = ctx.clock.now();
    await tx
      .update(refund)
      .set({
        status: move.to,
        manualMethod: method,
        manualReference: reference,
        manualRecordedBy: recordedBy,
        refundedAt: now,
        updatedAt: now,
      })
      .where(eq(refund.id, row.id));
    await settleRefunded(tx, ctx, row, row.status, role, { method });
    return { ok: true, status: "refunded" };
  });
}
