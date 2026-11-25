import { and, asc, desc, eq, gte, inArray, lt, sum } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import { ledgerAccount, ledgerLine, ledgerPosting } from "../../db/schema";

import { istDateRange, type IstDateRangeResult } from "./domain/period";
import { isLateAdjustment } from "./domain/period-lock";
import { parsePostingSeq } from "./domain/posting";
import { trialBalance } from "./domain/trial-balance";
import { findSourcePosting } from "./post";
import { postingLines } from "./rows";

type DateFilter = { from?: string; to?: string };
export type ListPostingsInput = DateFilter & {
  accountCode?: string;
  cursor?: string | bigint;
  limit?: number;
};

function dateFilter(range: Extract<IstDateRangeResult, { ok: true }>) {
  return and(
    range.fromInclusive
      ? gte(ledgerPosting.occurredAt, range.fromInclusive)
      : undefined,
    range.toExclusive
      ? lt(ledgerPosting.occurredAt, range.toExclusive)
      : undefined
  );
}

const sums = {
  debitMinor: sum(ledgerLine.debitMinor),
  creditMinor: sum(ledgerLine.creditMinor),
};

function paiseTotals(row: {
  debitMinor: string | null;
  creditMinor: string | null;
}) {
  return {
    debitMinor: BigInt(row.debitMinor ?? 0),
    creditMinor: BigInt(row.creditMinor ?? 0),
  };
}

export async function listPostings(
  ctx: PolicyContext,
  input: ListPostingsInput
) {
  await authorize(ctx, "ledger.read");
  const range = istDateRange(input);
  if (!range.ok) return range;
  const cursor =
    input.cursor === undefined ? undefined : parsePostingSeq(input.cursor);
  const limit = input.limit ?? 30;
  if (
    (input.cursor !== undefined && cursor === undefined) ||
    (input.accountCode && !/^\d{4}$/.test(input.accountCode)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return { ok: false, error: "invalid_filter" } as const;
  }

  return ctx.db.transaction(
    async (tx) => {
      const category = input.accountCode
        ? tx
            .select({ id: ledgerLine.postingId })
            .from(ledgerLine)
            .innerJoin(
              ledgerAccount,
              eq(ledgerAccount.id, ledgerLine.accountId)
            )
            .where(eq(ledgerAccount.code, input.accountCode))
        : undefined;
      // Match postings by a line's category, then total all their lines.
      const matching = and(
        dateFilter(range),
        category ? inArray(ledgerPosting.id, category) : undefined
      );
      const [totals] = await tx
        .select(sums)
        .from(ledgerPosting)
        .innerJoin(ledgerLine, eq(ledgerLine.postingId, ledgerPosting.id))
        .where(matching);
      const rows = await tx
        .select({
          seq: ledgerPosting.seq,
          sourceType: ledgerPosting.sourceType,
          occurredAt: ledgerPosting.occurredAt,
          periodMonth: ledgerPosting.periodMonth,
          description: ledgerPosting.description,
          ...sums,
        })
        .from(ledgerPosting)
        .innerJoin(ledgerLine, eq(ledgerLine.postingId, ledgerPosting.id))
        .where(
          and(
            matching,
            cursor === undefined ? undefined : lt(ledgerPosting.seq, cursor)
          )
        )
        .groupBy(ledgerPosting.id)
        .orderBy(desc(ledgerPosting.seq))
        .limit(limit + 1);
      const nextCursor = rows.length > limit ? rows[limit - 1]!.seq : null;
      return {
        ok: true,
        totals: paiseTotals(totals!),
        postings: rows.slice(0, limit).map((row) => ({
          ...row,
          ...paiseTotals(row),
          lateAdjustment: isLateAdjustment(row),
        })),
        nextCursor,
      } as const;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

export async function getPosting(ctx: PolicyContext, seq: string | bigint) {
  await authorize(ctx, "ledger.read");
  const number = parsePostingSeq(seq);
  if (number === undefined) return { ok: false, error: "not_found" } as const;
  const [posting] = await ctx.db
    .select()
    .from(ledgerPosting)
    .where(eq(ledgerPosting.seq, number));
  if (!posting) return { ok: false, error: "not_found" } as const;

  const [lines, original, reversal] = await Promise.all([
    postingLines(ctx.db, posting.id),
    posting.reversalOfPostingId
      ? ctx.db
          .select({ seq: ledgerPosting.seq })
          .from(ledgerPosting)
          .where(eq(ledgerPosting.id, posting.reversalOfPostingId))
      : [],
    posting.sourceType === "manual"
      ? findSourcePosting(ctx.db, { type: "reversal", id: posting.id })
      : undefined,
  ]);
  return {
    ok: true,
    posting: {
      ...posting,
      lateAdjustment: isLateAdjustment(posting),
      lines,
      reversalOfSeq: original[0]?.seq ?? null,
      reversedBySeq: reversal?.seq ?? null,
    },
  } as const;
}

export async function listLedgerAccounts(ctx: PolicyContext) {
  await authorize(ctx, "ledger.read");
  return ctx.db
    .select({
      code: ledgerAccount.code,
      name: ledgerAccount.name,
      kind: ledgerAccount.kind,
      isSystem: ledgerAccount.isSystem,
      isActive: ledgerAccount.isActive,
      publicLabel: ledgerAccount.publicLabel,
      publicGroup: ledgerAccount.publicGroup,
    })
    .from(ledgerAccount)
    .orderBy(asc(ledgerAccount.code));
}

/** Totals from the journal, including historical lines on inactive accounts. */
export async function ledgerTrialBalance(db: AppDb, dates: DateFilter = {}) {
  const range = istDateRange(dates);
  if (!range.ok) throw new RangeError(range.error);
  const accounts = await db
    .select({ accountCode: ledgerAccount.code, ...sums })
    .from(ledgerLine)
    .innerJoin(ledgerPosting, eq(ledgerPosting.id, ledgerLine.postingId))
    .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerLine.accountId))
    .where(dateFilter(range))
    .groupBy(ledgerAccount.code);
  return trialBalance(
    accounts.map((row) => ({
      accountCode: row.accountCode,
      ...paiseTotals(row),
    }))
  );
}
