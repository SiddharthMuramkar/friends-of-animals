// approveRefund({ refundId, note? }) and rejectRefund({ refundId, note })
// (#80): finance decides a requested refund, behind a second factor passed
// in the last 10 minutes (#60), and never their own request, even when
// they also hold a role that may ask for one.
//
// - approve: the refund is approved. A gateway refund goes out from the
//   outbox (refund.approved → refunds.send, ./sync-refund.ts) in the same
//   transaction, so approval never waits on the gateway and a crash can't
//   lose it. A manual refund (the batch was paid offline) waits for finance
//   to record paying it (./record-manual-refund.ts).
// - reject: with a note of 1 to 500 characters. Its students are let go,
//   so they may be asked for again. Finance may also close a refund the
//   gateway failed, instead of retrying it.
//
// Each decision is written to the audit log, before and after, in the
// same transaction.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { Role } from "../../../access/domain/roles";
import type { AppDb } from "../../../db/app-db";
import { refund, type RefundRow } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox/emit";
import type { UseCaseContext } from "../../../use-cases";
import { checkRefundDecision, nextRefundStatus } from "../domain/refund-status";
import { auditRefund, checkRefundText, lockRefund, releaseItems } from "./rows";

export type ApproveRefundInput = { refundId: string; note?: string };

export type ApproveRefundResult =
  | { ok: true; status: "approved" }
  | InvalidInput
  | {
      ok: false;
      error: "not_found" | "not_requested" | "same_person" | "note_too_long";
    };

export type RejectRefundInput = { refundId: string; note: string };

export type RejectRefundResult =
  | { ok: true; status: "rejected" }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "not_rejectable"
        | "same_person"
        | "note_required"
        | "note_too_long";
    };

const approveInput = z.strictObject({
  refundId: z.uuid(),
  note: z.string().max(4000).optional(),
});

const rejectInput = z.strictObject({
  refundId: z.uuid(),
  note: z.string().max(4000),
});

function deciderOf(ctx: UseCaseContext): string {
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  return ctx.actor.userId;
}

/**
 * Queues an approved gateway refund's send, in the caller's transaction.
 * A manual refund has nothing to send.
 */
export async function queueSend(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock">,
  row: Pick<RefundRow, "id" | "method">
): Promise<void> {
  if (row.method !== "gateway") return;
  await emit(tx, ctx.clock, {
    type: "refund.approved",
    aggregate: { type: "refund", id: row.id },
    payload: { refundId: row.id },
  });
}

export async function approveRefund(
  ctx: UseCaseContext,
  input: ApproveRefundInput
): Promise<ApproveRefundResult> {
  const { role } = await authorize(ctx, "refunds.decide");
  const parsed = approveInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const decidedBy = deciderOf(ctx);
  const note = checkRefundText(parsed.data.note ?? "", { required: false });
  if (!note.ok) return { ok: false, error: "note_too_long" };

  return ctx.db.transaction(async (tx): Promise<ApproveRefundResult> => {
    const row = await lockRefund(tx, parsed.data.refundId);
    if (!row) return { ok: false, error: "not_found" };
    const check = checkRefundDecision(row, decidedBy);
    if (!check.ok) return { ok: false, error: check.reason };
    const move = nextRefundStatus(row.status, "approved");
    if (!move.ok) return { ok: false, error: "not_requested" };
    const now = ctx.clock.now();
    await tx
      .update(refund)
      .set({
        status: move.to,
        decidedBy,
        decidedAt: now,
        decisionNote: note.text,
        updatedAt: now,
      })
      .where(eq(refund.id, row.id));
    await auditRefund(
      tx,
      ctx,
      row.id,
      {
        action: "refund.approved",
        before: { status: row.status },
        after: { status: move.to, decidedBy, method: row.method },
      },
      role
    );
    await queueSend(tx, ctx, row);
    return { ok: true, status: "approved" };
  });
}

export async function rejectRefund(
  ctx: UseCaseContext,
  input: RejectRefundInput
): Promise<RejectRefundResult> {
  const { role } = await authorize(ctx, "refunds.decide");
  const parsed = rejectInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const decidedBy = deciderOf(ctx);
  const note = checkRefundText(parsed.data.note, { required: true });
  if (!note.ok) {
    return {
      ok: false,
      error: note.error === "required" ? "note_required" : "note_too_long",
    };
  }

  return ctx.db.transaction(async (tx): Promise<RejectRefundResult> => {
    const row = await lockRefund(tx, parsed.data.refundId);
    if (!row) return { ok: false, error: "not_found" };
    if (row.status === "requested") {
      const check = checkRefundDecision(row, decidedBy);
      if (!check.ok) return { ok: false, error: check.reason === "same_person" ? "same_person" : "not_rejectable" };
    }
    const move = nextRefundStatus(row.status, "rejected");
    if (!move.ok) return { ok: false, error: "not_rejectable" };
    await rejectLocked(tx, ctx, row, { decidedBy, note: note.text, role });
    return { ok: true, status: "rejected" };
  });
}

/**
 * Rejects `row` (locked by the caller, requested or failed): it lets its
 * students go and writes the audit entry. Also how a cancellation (80b)
 * supersedes a request (./start-system-refund.ts).
 */
export async function rejectLocked(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  row: RefundRow,
  {
    decidedBy,
    note,
    role,
  }: { decidedBy: string | null; note: string | null; role: Role | null }
): Promise<void> {
  const move = nextRefundStatus(row.status, "rejected");
  if (!move.ok) throw new Error(`Refund ${row.id} can't be rejected`);
  const now = ctx.clock.now();
  await tx
    .update(refund)
    .set({
      status: move.to,
      decidedBy,
      decidedAt: now,
      decisionNote: note,
      updatedAt: now,
    })
    .where(eq(refund.id, row.id));
  await releaseItems(tx, row.id, now);
  await auditRefund(
    tx,
    ctx,
    row.id,
    {
      action: "refund.rejected",
      before: { status: row.status },
      after: { status: move.to, decidedBy },
    },
    role
  );
}
