// A round has at most one source, and a source can feed several rounds.
// The competition row serializes graph edits; candidates are checked against
// its current graph, never a supplied competition or an inferred level.
import type { JudgingRoundStatus } from "./round-status";

export type ChainRound = {
  id: string;
  competitionId: string;
  status: JudgingRoundStatus;
  sourceRoundId: string | null;
};

export type SourceProblem =
  | "round_not_editable"
  | "source_is_self"
  | "source_not_found"
  | "source_cancelled"
  | "chain_cycle";

/** The target must be included (a new draft may not yet exist in storage). */
export function sourceProblem(
  rounds: readonly ChainRound[],
  roundId: string,
  sourceRoundId: string
): SourceProblem | null {
  const byId = new Map(rounds.map((round) => [round.id, round]));
  const target = byId.get(roundId);
  if (!target || target.status !== "draft") return "round_not_editable";
  if (roundId === sourceRoundId) return "source_is_self";
  const source = byId.get(sourceRoundId);
  if (!source || source.competitionId !== target.competitionId)
    return "source_not_found";
  if (source.status === "cancelled") return "source_cancelled";
  // A malformed existing loop must also fail closed, never hang.
  const seen = new Set([roundId]);
  let cursor: string | null = sourceRoundId;
  while (cursor !== null) {
    if (seen.has(cursor)) return "chain_cycle";
    seen.add(cursor);
    const predecessor = byId.get(cursor);
    if (!predecessor || predecessor.competitionId !== target.competitionId)
      return "source_not_found";
    cursor = predecessor.sourceRoundId;
  }
  return null;
}
