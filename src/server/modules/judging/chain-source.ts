// The only source of advancing outcomes is the immutable locked rank snapshot
// and its current recognition tags, not scores or assignments from the source.
import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { roundResult, type JudgingRound } from "../../db/schema";
import { advances } from "./domain/outcomes";
import { loadRound } from "./rounds";

export async function loadFinalistSource(
  db: AppDb,
  round: JudgingRound,
  lock = false
) {
  if (!round.sourceRoundId) return null;
  const source = await loadRound(db, round.sourceRoundId, lock);
  if (!source || source.competitionId !== round.competitionId) return null;
  const rows =
    source.status === "locked"
      ? await db
          .select({
            entryId: roundResult.entryId,
            outcome: roundResult.outcome,
          })
          .from(roundResult)
          .where(eq(roundResult.roundId, source.id))
      : [];
  return {
    id: source.id,
    name: source.name,
    status: source.status,
    finalists: new Set(
      rows.filter((r) => advances(r.outcome)).map((r) => r.entryId)
    ),
  };
}
