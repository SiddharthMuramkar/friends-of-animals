import { eq } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import { ledgerPosting } from "../../db/schema";

import { postingDescription } from "./descriptions";
import { fromColumns, parsePostingSeq, reverseLines } from "./domain/posting";
import { LedgerPostingError, postToLedger } from "./post";
import { postingLines } from "./rows";

export async function reversePosting(ctx: PolicyContext, seq: string | bigint) {
  const { role } = await authorize(ctx, "ledger.write");
  const number = parsePostingSeq(seq);
  if (number === undefined) return { ok: false, error: "not_found" } as const;
  try {
    return await reverse(ctx, role, number);
  } catch (error) {
    // A reversal is dated today: refused while the current month is locked.
    if (error instanceof LedgerPostingError && error.code === "period_locked")
      return { ok: false, error: error.code } as const;
    throw error;
  }
}

function reverse(
  ctx: PolicyContext,
  role: Awaited<ReturnType<typeof authorize>>["role"],
  number: bigint
) {
  return ctx.db.transaction(async (tx) => {
    const [original] = await tx
      .select({
        id: ledgerPosting.id,
        sourceType: ledgerPosting.sourceType,
        competitionId: ledgerPosting.competitionId,
      })
      .from(ledgerPosting)
      .where(eq(ledgerPosting.seq, number));
    if (!original) return { ok: false, error: "not_found" } as const;
    if (original.sourceType !== "manual")
      return { ok: false, error: "not_reversible" } as const;

    const lines = await postingLines(tx, original.id);
    const reversed = await postToLedger(
      tx,
      { ...ctx, actorRole: role },
      {
        source: { type: "reversal", id: original.id },
        occurredAt: ctx.clock.now(),
        description: postingDescription("reversal", { seq: number.toString() }),
        lines: reverseLines(lines.map(fromColumns)),
        reversalOfPostingId: original.id,
        competitionId: original.competitionId ?? undefined,
      }
    );
    if (reversed.outcome === "duplicate")
      return { ok: false, error: "already_reversed" } as const;
    return {
      ok: true,
      postingId: reversed.postingId,
      seq: reversed.seq,
    } as const;
  });
}
