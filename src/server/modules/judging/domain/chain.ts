// Chained judging levels (#98). A competition manager can feed a round
// from the finalists of another round in the same competition, for
// example city -> state -> national -> global. Each round has at most one
// source, and a source may feed several rounds, so the rounds of a
// competition form a forest. A round never feeds itself, directly or
// through a loop.
//
// Pure: the caller loads every round of the competition, after locking
// them, so two edits can't close a loop between them.
//
// Loads under plain Node: relative imports only.

/**
 * The same values as the FOA rounds ticket's `JudgingRoundStatus`; replace
 * this with that import once both are on one branch.
 */
export type ChainRoundStatus = "draft" | "open" | "locked" | "cancelled";

/** What the chain rules read about a round. */
export type ChainRound = {
  id: string;
  competitionId: string;
  status: ChainRoundStatus;
  sourceRoundId: string | null;
};

export type SourceProblem =
  /** Only a draft round's source changes, as with its other settings. */
  | "round_not_editable"
  | "source_is_self"
  /** Missing, or in another competition: the two look the same. */
  | "source_not_found"
  | "source_cancelled"
  | "chain_cycle";

/**
 * Why `sourceRoundId` can't become the source of round `roundId`, or null
 * if it can. `rounds` are the competition's rounds as they are now and
 * must include `roundId`. A source may be a draft, open or locked: its
 * finalists flow once it is locked and its outcomes are tagged.
 */
export function sourceProblem(
  rounds: readonly ChainRound[],
  roundId: string,
  sourceRoundId: string
): SourceProblem | null {
  const byId = new Map(rounds.map((round) => [round.id, round]));
  const target = byId.get(roundId);
  if (target === undefined) {
    throw new Error(`Round ${roundId} is not among the rounds given`);
  }
  if (target.status !== "draft") return "round_not_editable";
  if (roundId === sourceRoundId) return "source_is_self";
  const source = byId.get(sourceRoundId);
  if (source === undefined || source.competitionId !== target.competitionId) {
    return "source_not_found";
  }
  if (source.status === "cancelled") return "source_cancelled";
  if (upstreamOf(byId, sourceRoundId).includes(roundId)) return "chain_cycle";
  return null;
}

/**
 * `roundId` and the rounds above it, nearest first. Stops at a round seen
 * before, so data that already holds a loop can't hang the walk.
 */
function upstreamOf(
  byId: ReadonlyMap<string, ChainRound>,
  roundId: string
): string[] {
  const seen: string[] = [];
  let current: string | null = roundId;
  while (current !== null && !seen.includes(current)) {
    seen.push(current);
    current = byId.get(current)?.sourceRoundId ?? null;
  }
  return seen;
}

/**
 * The rounds whose results are the competition's final ones: every round
 * that isn't cancelled and that no other live round takes finalists from.
 * In the pilot's single national round, that round. In input order.
 */
export function finalRoundIds(rounds: readonly ChainRound[]): string[] {
  const live = rounds.filter((round) => round.status !== "cancelled");
  const feeding = new Set(live.map((round) => round.sourceRoundId));
  return live.filter((round) => !feeding.has(round.id)).map(({ id }) => id);
}

/**
 * The rounds as the levels page lists them: each chain from its first
 * round down, a round's next rounds in the order given, with how far down
 * the chain each one sits. A round whose source isn't listed starts a
 * chain. Every round appears exactly once.
 */
export function chainOrder(
  rounds: readonly ChainRound[]
): { round: ChainRound; depth: number }[] {
  const ids = new Set(rounds.map((round) => round.id));
  const listed: { round: ChainRound; depth: number }[] = [];
  const visited = new Set<string>();
  const visit = (round: ChainRound, depth: number) => {
    if (visited.has(round.id)) return;
    visited.add(round.id);
    listed.push({ round, depth });
    for (const next of rounds) {
      if (next.sourceRoundId === round.id) visit(next, depth + 1);
    }
  };
  const starts = rounds.filter(
    (round) => round.sourceRoundId === null || !ids.has(round.sourceRoundId)
  );
  for (const round of starts) visit(round, 0);
  // Only reached if the data already holds a loop.
  for (const round of rounds) visit(round, 0);
  return listed;
}
