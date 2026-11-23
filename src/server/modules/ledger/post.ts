import { and, asc, eq, inArray } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { ledgerAccount, ledgerLine, ledgerPosting } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { Clock } from "../../ports/clock";

import { periodMonthOf } from "./domain/period";
import {
  checkLines,
  toColumns,
  type LineDraft,
  type LinesCheck,
} from "./domain/posting";
import type { LedgerSourceType } from "./domain/posting-rules";

type Source = { type: LedgerSourceType; id: string };
type PostingDraft = {
  source: Source;
  occurredAt: Date;
  description: string;
  lines: readonly LineDraft[];
  competitionId?: string;
  reversalOfPostingId?: string;
};
type PostingActor = { actor: Actor; clock: Clock; actorRole?: Role | null };
export type PostedEntry = {
  outcome: "posted" | "duplicate";
  postingId: string;
  seq: bigint;
};

type PostingErrorCode =
  | Extract<LinesCheck, { ok: false }>["error"]
  | "invalid_description"
  | "invalid_memo"
  | "unknown_account"
  | "inactive_account";

export class LedgerPostingError extends Error {
  constructor(readonly code: PostingErrorCode) {
    super(code);
    this.name = "LedgerPostingError";
  }
}

const postingIdentity = { postingId: ledgerPosting.id, seq: ledgerPosting.seq };

export async function findSourcePosting(db: AppDb, source: Source) {
  const [posting] = await db
    .select(postingIdentity)
    .from(ledgerPosting)
    .where(
      and(
        eq(ledgerPosting.sourceType, source.type),
        eq(ledgerPosting.sourceId, source.id)
      )
    );
  return posting;
}

/** Writes a balanced journal entry and its audit row in the caller's transaction. */
export async function postToLedger(
  tx: AppDb,
  ctx: PostingActor,
  entry: PostingDraft
): Promise<PostedEntry> {
  const previous = await findSourcePosting(tx, entry.source);
  if (previous) return { outcome: "duplicate", ...previous };

  const description = entry.description.trim();
  if (
    !description ||
    description.length > 500 ||
    description.includes("\u0000")
  ) {
    throw new LedgerPostingError("invalid_description");
  }
  const checked = checkLines(entry.lines);
  if (!checked.ok) throw new LedgerPostingError(checked.error);

  const codes = [...new Set(entry.lines.map(({ accountCode }) => accountCode))];
  // A concurrent category deactivation has to wait until this entry commits.
  const accounts = await tx
    .select({
      id: ledgerAccount.id,
      code: ledgerAccount.code,
      active: ledgerAccount.isActive,
    })
    .from(ledgerAccount)
    .where(inArray(ledgerAccount.code, codes))
    .orderBy(asc(ledgerAccount.code))
    .for("share");
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const lines = entry.lines.map((line, index) => {
    const account = byCode.get(line.accountCode);
    if (!account) throw new LedgerPostingError("unknown_account");
    // Reversals must still be able to correct postings on a retired category.
    if (!account.active && entry.source.type !== "reversal") {
      throw new LedgerPostingError("inactive_account");
    }
    const memo = line.memo?.trim() || null;
    if (memo && (memo.length > 200 || memo.includes("\u0000"))) {
      throw new LedgerPostingError("invalid_memo");
    }
    return {
      accountId: account.id,
      lineNo: index + 1,
      memo,
      ...toColumns(line),
    };
  });

  const now = ctx.clock.now();
  const periodMonth = periodMonthOf(entry.occurredAt);
  const [posting] = await tx
    .insert(ledgerPosting)
    .values({
      id: entry.source.type === "manual" ? entry.source.id : uuidv7(now),
      sourceType: entry.source.type,
      sourceId: entry.source.id,
      occurredAt: entry.occurredAt,
      periodMonth,
      description,
      expectedLineCount: lines.length,
      competitionId: entry.competitionId,
      reversalOfPostingId: entry.reversalOfPostingId,
      createdByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      createdAt: now,
    })
    .onConflictDoNothing({
      target: [ledgerPosting.sourceType, ledgerPosting.sourceId],
    })
    .returning(postingIdentity);
  if (!posting) {
    const winner = await findSourcePosting(tx, entry.source);
    if (!winner) throw new Error("Conflicting ledger source was not found");
    return { outcome: "duplicate", ...winner };
  }

  await tx.insert(ledgerLine).values(
    lines.map((line) => ({
      ...line,
      id: uuidv7(now),
      postingId: posting.postingId,
    }))
  );
  await recordAudit(tx, ctx, {
    action:
      entry.source.type === "reversal"
        ? "ledger.posting_reversed"
        : "ledger.posting_created",
    entity: { type: "ledger_posting", id: posting.postingId },
    before: null,
    after: {
      seq: posting.seq.toString(),
      sourceType: entry.source.type,
      sourceId: entry.source.id,
      reversalOfPostingId: entry.reversalOfPostingId ?? null,
      competitionId: entry.competitionId ?? null,
      periodMonth,
      accountCodes: codes,
      totalMinor: checked.totalMinor.toString(),
      lineCount: lines.length,
    },
    actorRole: ctx.actorRole ?? null,
  });
  return { outcome: "posted", ...posting };
}
