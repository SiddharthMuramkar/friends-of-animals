// A locked round's outcomes: one per entry, plus an independent "suitable
// for auction" flag. This is the one outcome model that chained rounds,
// results, certificates, the gallery, auctions and the engagement history
// read, so it stays small:
//
// - `outcome`: winner, runner_up, finalist, special_mention or none.
// - `awardPosition`: the place within the round's award scheme. Winners
//   hold 1 and runners-up 2 or more; no other outcome has one. Ranked and
//   medal schemes have three places (1st/2nd/3rd, gold/silver/bronze),
//   grades two (A, B).
// - `advances`: winners, runners-up and finalists go on to a round that
//   takes this round's finalists.
//
// Defaults to confirm with FOA (HR-40): the top three ranks prefill as
// winner and runners-up under ranked and medal schemes; grades start
// untagged because a grade isn't a rank.
//
// Loads under plain Node: relative imports only.

export const ROUND_OUTCOMES = [
  "winner",
  "runner_up",
  "finalist",
  "special_mention",
  "none",
] as const;

export type RoundOutcome = (typeof ROUND_OUTCOMES)[number];

/** As the competition's award settings name them; ranked_123 by default. */
import {
  AWARD_BANDS,
  type AwardScheme,
} from "../../competitions/domain/award-schemes";

export type OutcomeTag = {
  entryId: string;
  outcome: RoundOutcome;
  awardPosition: number | null;
  suitableForAuction: boolean;
};

const places = (scheme: AwardScheme) => AWARD_BANDS[scheme].length;

/** Whether an entry with this outcome goes on to a next round. */
export function advances(outcome: RoundOutcome): boolean {
  return (
    outcome === "winner" || outcome === "runner_up" || outcome === "finalist"
  );
}

function positionFits(scheme: AwardScheme, tag: OutcomeTag): boolean {
  const position = tag.awardPosition;
  switch (tag.outcome) {
    case "winner":
      return position === 1;
    case "runner_up":
      return (
        position !== null &&
        Number.isInteger(position) &&
        position >= 2 &&
        position <= places(scheme)
      );
    default:
      return position === null;
  }
}

/** The tags the outcomes form starts with, from the locked ranking. */
export function prefillOutcomes(
  scheme: AwardScheme,
  ranked: readonly { entryId: string; rank: number }[]
): OutcomeTag[] {
  const positional = scheme !== "grades_ab";
  return ranked.map(({ entryId, rank }) => {
    const placed = positional && rank <= places(scheme);
    return {
      entryId,
      outcome: !placed ? "none" : rank === 1 ? "winner" : "runner_up",
      awardPosition: placed ? rank : null,
      suitableForAuction: false,
    };
  });
}

export type OutcomeTagProblem = {
  code: "unknown_entry" | "duplicate_entry" | "award_position_invalid";
  entryId: string;
};

/**
 * Why these tags can't be saved for a round whose ranked entries are
 * `entryIds`; empty if they can. Entries left out keep outcome "none".
 */
export function outcomeTagProblems(
  scheme: AwardScheme,
  entryIds: readonly string[],
  tags: readonly OutcomeTag[]
): OutcomeTagProblem[] {
  const inRound = new Set(entryIds);
  const seen = new Set<string>();
  const problems: OutcomeTagProblem[] = [];
  for (const tag of tags) {
    if (seen.has(tag.entryId)) {
      problems.push({ code: "duplicate_entry", entryId: tag.entryId });
      continue;
    }
    seen.add(tag.entryId);
    if (!inRound.has(tag.entryId)) {
      problems.push({ code: "unknown_entry", entryId: tag.entryId });
    } else if (!positionFits(scheme, tag)) {
      problems.push({ code: "award_position_invalid", entryId: tag.entryId });
    }
  }
  return problems;
}
