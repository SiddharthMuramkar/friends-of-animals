import { z } from "zod";

import { authorize, type PolicyContext } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import { uuidv7 } from "../../ids";
import type { Clock } from "../../ports/clock";
import { readSetting } from "../settings/read";

import { insertFinanceRequest } from "./approval-requests";
import { needsSecondApprover, thresholdMinor } from "./domain/approval";
import { MAX_ENTRY_AMOUNT_MINOR } from "./domain/money";
import { parseIstDate } from "./domain/period";
import { MAX_LINES, type LineDraft } from "./domain/posting";
import { isClosedForEntries } from "./periods";
import { LedgerPostingError, postToLedger, preparePosting } from "./post";

export type ManualEntryInput = {
  date: string;
  description: string;
  lines: readonly LineDraft[];
};

const fields = z.object({
  date: z.string(),
  description: z.string(),
  lines: z
    .array(
      z.object({
        accountCode: z.string().trim(),
        side: z.enum(["debit", "credit"]),
        amountMinor: z.bigint(),
        memo: z.string().optional(),
      })
    )
    .max(MAX_LINES),
});

/**
 * A manual entry waiting for a second approver (#109), as the request
 * stores it: amounts as decimal strings, since JSON has no bigint.
 */
export const manualEntryPayload = z.object({
  date: z.string(),
  description: z.string(),
  lines: z
    .array(
      z.object({
        accountCode: z.string(),
        side: z.enum(["debit", "credit"]),
        amountMinor: z.string().regex(/^[1-9]\d{0,18}$/),
        memo: z.string().optional(),
      })
    )
    .min(2)
    .max(MAX_LINES),
});

export type ManualEntryPayload = z.infer<typeof manualEntryPayload>;

export function payloadLines(payload: ManualEntryPayload): LineDraft[] {
  return payload.lines.map((line) => ({
    ...line,
    amountMinor: BigInt(line.amountMinor),
  }));
}

/** Posts an approved manual entry in the approver's transaction. */
export async function executeManualEntry(
  tx: AppDb,
  ctx: { actor: Actor; clock: Clock; actorRole: Role | null },
  payload: ManualEntryPayload,
  request: { id: string; requestedByUserId: string }
) {
  const day = parseIstDate(payload.date);
  if (!day.ok) throw new Error("A stored manual entry has a bad date");
  try {
    const posted = await postToLedger(tx, ctx, {
      // The request's id, so an approval can post its entry only once.
      source: { type: "manual", id: request.id },
      occurredAt: day.start,
      description: payload.description,
      lines: payloadLines(payload),
      createdByUserId: request.requestedByUserId,
    });
    return {
      ok: true,
      postingId: posted.postingId,
      seq: posted.seq,
    } as const;
  } catch (error) {
    if (error instanceof LedgerPostingError)
      return { ok: false, error: error.code } as const;
    throw error;
  }
}

/**
 * Finance books a manual entry. One moving more than the
 * `ledger.manualEntryApprovalThresholdRupees` setting waits for a second
 * finance user instead (#109), after the same checks.
 */
export async function createManualEntry(
  ctx: PolicyContext,
  input: ManualEntryInput
) {
  const { role } = await authorize(ctx, "ledger.write");
  if (Array.isArray(input?.lines) && input.lines.length > MAX_LINES)
    return { ok: false, error: "too_many_lines" } as const;
  const parsed = fields.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" } as const;
  const { date, description, lines } = parsed.data;
  const day = parseIstDate(date);
  if (!day.ok) return day;
  const now = ctx.clock.now();
  if (day.start > now) return { ok: false, error: "future_date" } as const;
  if (lines.some(({ amountMinor }) => amountMinor > MAX_ENTRY_AMOUNT_MINOR)) {
    return { ok: false, error: "amount_too_large" } as const;
  }
  const entry = {
    source: { type: "manual", id: uuidv7(now) },
    occurredAt: day.start,
    description,
    lines,
  } as const;

  try {
    return await ctx.db.transaction(async (tx) => {
      const prepared = await preparePosting(tx, entry);
      const threshold = await readSetting(
        tx,
        "ledger.manualEntryApprovalThresholdRupees"
      );
      const waits = needsSecondApprover({
        operation: "manual_entry",
        totalMinor: prepared.totalMinor,
        thresholdMinor: thresholdMinor(threshold),
      });
      if (!waits) {
        const { postingId, seq } = await postToLedger(
          tx,
          { ...ctx, actorRole: role },
          entry
        );
        return { ok: true, status: "posted", postingId, seq } as const;
      }
      if (await isClosedForEntries(tx, day.start))
        return { ok: false, error: "period_locked" } as const;
      const requestId = await insertFinanceRequest(tx, ctx, role, {
        operation: "manual_entry",
        payload: {
          date,
          description: prepared.description,
          lines: lines.map((line) => ({
            accountCode: line.accountCode,
            side: line.side,
            amountMinor: line.amountMinor.toString(),
            ...(line.memo?.trim() ? { memo: line.memo.trim() } : {}),
          })),
        } satisfies ManualEntryPayload,
        audit: {
          date,
          accountCodes: prepared.codes,
          totalMinor: prepared.totalMinor.toString(),
          lineCount: lines.length,
        },
      });
      return { ok: true, status: "pending_approval", requestId } as const;
    });
  } catch (error) {
    if (error instanceof LedgerPostingError)
      return { ok: false, error: error.code } as const;
    throw error;
  }
}
