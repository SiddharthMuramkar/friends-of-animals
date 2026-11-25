import { and, asc, eq, inArray } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { ledgerAccount, ledgerLine, ledgerPosting } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { Clock } from "../../ports/clock";

import { resolvePostingPeriod } from "./periods";
import {
  checkLines,
  toColumns,
  type LineDraft,
  type LinesCheck,
} from "./domain/posting";
import {
  isLedgerSourceType,
  type LedgerSourceType,
} from "./domain/posting-rules";

type Source = { type: LedgerSourceType; id: string };
export type PostingDraft = {
  source: Source;
  occurredAt: Date;
  description: string;
  lines: readonly LineDraft[];
  competitionId?: string;
  reversalOfPostingId?: string;
  /** Who entered it, when not the actor: the requester of an approved manual entry. */
  createdByUserId?: string;
};
type PostingActor = { actor: Actor; clock: Clock; actorRole?: Role | null };
export type PostedEntry = {
  outcome: "posted" | "duplicate";
  postingId: string;
  seq: bigint;
};

type PostingErrorCode =
  | Extract<LinesCheck, { ok: false }>["error"]
  | "invalid_source_type"
  | "invalid_description"
  | "invalid_memo"
  | "unknown_account"
  | "inactive_account"
  | "period_locked";

export class LedgerPostingError extends Error {
  constructor(readonly code: PostingErrorCode) {
    super(code);
    this.name = "LedgerPostingError";
  }
}

const postingIdentity = { postingId: ledgerPosting.id, seq: ledgerPosting.seq };

function exceedsCharacterLimit(text: string, limit: number): boolean {
  // PostgreSQL's char_length and JavaScript's string iterator count code points.
  if (text.length <= limit) return false;
  let characters = 0;
  for (const _ of text) {
    characters += 1;
    if (characters > limit) return true;
  }
  return false;
}

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

/**
 * Checks an entry against the chart and the posting rules without writing
 * it: what a manual entry waiting for a second approver must pass first.
 * Throws LedgerPostingError.
 */
export async function preparePosting(tx: AppDb, entry: PostingDraft) {
  if (!isLedgerSourceType(entry.source.type)) {
    throw new LedgerPostingError("invalid_source_type");
  }
  const description = entry.description.trim();
  if (
    !description ||
    exceedsCharacterLimit(description, 500) ||
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
    if (memo && (exceedsCharacterLimit(memo, 200) || memo.includes("\u0000"))) {
      throw new LedgerPostingError("invalid_memo");
    }
    return {
      accountId: account.id,
      lineNo: index + 1,
      memo,
      ...toColumns(line),
    };
  });
  return { description, codes, lines, totalMinor: checked.totalMinor };
}

/**
 * Which kind of posting decides what a closed period does to it (#109):
 * an automatic posting (a capture, a refund) can't be refused, so it moves
 * past the lock line as a late adjustment; finance's own entries and
 * reversals are refused instead.
 */
function periodMode(type: LedgerSourceType): "automatic" | "manual" {
  return type === "manual" || type === "reversal" ? "manual" : "automatic";
}

/** Writes a balanced journal entry and its audit row in the caller's transaction. */
export async function postToLedger(
  tx: AppDb,
  ctx: PostingActor,
  entry: PostingDraft
): Promise<PostedEntry> {
  if (!isLedgerSourceType(entry.source.type)) {
    throw new LedgerPostingError("invalid_source_type");
  }
  const previous = await findSourcePosting(tx, entry.source);
  if (previous) return { outcome: "duplicate", ...previous };

  const { description, codes, lines, totalMinor } = await preparePosting(
    tx,
    entry
  );
  const period = await resolvePostingPeriod(tx, {
    occurredAt: entry.occurredAt,
    mode: periodMode(entry.source.type),
    now: ctx.clock.now(),
  });
  if (!period.ok) throw new LedgerPostingError(period.error);
  const { periodMonth, lateAdjustment } = period;

  const now = ctx.clock.now();
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
      createdByUserId:
        entry.createdByUserId ??
        (ctx.actor.kind === "user" ? ctx.actor.userId : null),
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
      ...(lateAdjustment ? { lateAdjustment } : {}),
      accountCodes: codes,
      totalMinor: totalMinor.toString(),
      lineCount: lines.length,
    },
    actorRole: ctx.actorRole ?? null,
  });
  return { outcome: "posted", ...posting };
}
