// The accountant's export (#109): every ledger line whose posting happened
// on the IST days asked for, as a journal CSV that balances. Exporting
// data needs a fresh second factor, writes one audit entry (the range and
// counts, never the content), and stays off until FOA's accountant
// confirms the format (`ledger.accountantExport`, HR-47).

import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { ledgerAccount, ledgerLine, ledgerPosting } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { readSetting } from "../settings/read";

import { buildJournalCsv, type JournalPosting } from "./domain/journal";
import { istDateRange } from "./domain/period";
import { isLateAdjustment } from "./domain/period-lock";

/** The longest range one export covers: a year, leap day included. */
export const MAX_EXPORT_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function exportLedger(
  ctx: PolicyContext,
  input: { from: string; to: string }
) {
  const { role } = await authorize(ctx, "ledger.export");
  if (!(await readSetting(ctx.db, "ledger.accountantExport")))
    return { ok: false, error: "export_not_enabled" } as const;
  const from = typeof input?.from === "string" ? input.from : "";
  const to = typeof input?.to === "string" ? input.to : "";
  if (!from || !to) return { ok: false, error: "invalid_date" } as const;
  const range = istDateRange({ from, to });
  if (!range.ok) return range;
  const start = range.fromInclusive!;
  const end = range.toExclusive!;
  if (end.getTime() - start.getTime() > MAX_EXPORT_DAYS * DAY_MS)
    return { ok: false, error: "range_too_long" } as const;

  return ctx.db.transaction(
    async (tx) => {
      const postings = await tx
        .select({
          id: ledgerPosting.id,
          seq: ledgerPosting.seq,
          occurredAt: ledgerPosting.occurredAt,
          periodMonth: ledgerPosting.periodMonth,
          description: ledgerPosting.description,
          sourceType: ledgerPosting.sourceType,
          sourceId: ledgerPosting.sourceId,
          reversalOfPostingId: ledgerPosting.reversalOfPostingId,
        })
        .from(ledgerPosting)
        .where(
          and(
            gte(ledgerPosting.occurredAt, start),
            lt(ledgerPosting.occurredAt, end)
          )
        )
        .orderBy(asc(ledgerPosting.seq));
      const lines =
        postings.length === 0
          ? []
          : await tx
              .select({
                postingId: ledgerLine.postingId,
                accountCode: ledgerAccount.code,
                accountName: ledgerAccount.name,
                debitMinor: ledgerLine.debitMinor,
                creditMinor: ledgerLine.creditMinor,
                memo: ledgerLine.memo,
              })
              .from(ledgerLine)
              .innerJoin(
                ledgerAccount,
                eq(ledgerAccount.id, ledgerLine.accountId)
              )
              .where(
                inArray(
                  ledgerLine.postingId,
                  postings.map(({ id }) => id)
                )
              )
              .orderBy(asc(ledgerLine.postingId), asc(ledgerLine.lineNo));
      const byPosting = Map.groupBy(lines, ({ postingId }) => postingId);
      // A reversal names its original by journal number, which may be
      // outside the range.
      const originalIds = [
        ...new Set(
          postings.flatMap(({ reversalOfPostingId }) =>
            reversalOfPostingId ? [reversalOfPostingId] : []
          )
        ),
      ];
      const originals = new Map(
        originalIds.length === 0
          ? []
          : (
              await tx
                .select({ id: ledgerPosting.id, seq: ledgerPosting.seq })
                .from(ledgerPosting)
                .where(inArray(ledgerPosting.id, originalIds))
            ).map(({ id, seq }) => [id, seq])
      );
      const journal = buildJournalCsv(
        postings.map((posting): JournalPosting => ({
          seq: posting.seq,
          occurredAt: posting.occurredAt,
          periodMonth: posting.periodMonth,
          narration: posting.description,
          sourceType: posting.sourceType,
          sourceRef: posting.sourceId,
          reversalOfSeq: posting.reversalOfPostingId
            ? (originals.get(posting.reversalOfPostingId) ?? null)
            : null,
          lateAdjustment: isLateAdjustment(posting),
          lines: byPosting.get(posting.id) ?? [],
        }))
      );
      await recordAudit(tx, ctx, {
        action: "ledger.exported",
        entity: { type: "ledger_export", id: uuidv7(ctx.clock.now()) },
        before: null,
        after: {
          from,
          to,
          postingCount: journal.postingCount,
          lineCount: journal.lineCount,
        },
        actorRole: role,
      });
      return {
        ok: true,
        csv: journal.csv,
        filename: `foa-ledger-${from}-${to}.csv`,
        totals: journal.totals,
        postingCount: journal.postingCount,
        lineCount: journal.lineCount,
      } as const;
    },
    { isolationLevel: "repeatable read" }
  );
}
