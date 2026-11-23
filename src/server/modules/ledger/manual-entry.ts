import { z } from "zod";

import { authorize, type PolicyContext } from "../../access/can";
import { uuidv7 } from "../../ids";

import { MAX_ENTRY_AMOUNT_MINOR } from "./domain/money";
import { parseIstDate } from "./domain/period";
import { MAX_LINES, type LineDraft } from "./domain/posting";
import { LedgerPostingError, postToLedger } from "./post";

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

  try {
    const { postingId, seq } = await ctx.db.transaction((tx) =>
      postToLedger(
        tx,
        {
          ...ctx,
          actorRole: role,
        },
        {
          source: { type: "manual", id: uuidv7(now) },
          occurredAt: day.start,
          description,
          lines,
        }
      )
    );
    return { ok: true, postingId, seq } as const;
  } catch (error) {
    if (error instanceof LedgerPostingError)
      return { ok: false, error: error.code } as const;
    throw error;
  }
}
