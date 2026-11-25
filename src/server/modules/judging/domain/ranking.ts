// Turns judges' score sheets into a ranking for one partition of a round
// (entries judged on the same rubric, for example one category and age
// group).
//
// - A sheet counts once every criterion has a value (the "scored" a round
//   lock waits for). Its total is
//     100 x sum(weight x (score - min) / (max - min)) / sum(weight).
// - An entry's score is the mean total of its finished sheets. Entries
//   with no finished sheet are listed as unscored, not ranked.
// - Higher scores rank first. Equal scores go to the stated tie-break
//   rule (TIE_BREAK_RULE), whose wording FOA confirms (HR-40):
//     1. the higher mean on each criterion, highest weight first, rubric
//        order breaking equal weights;
//     2. the higher median sheet total;
//     3. otherwise the entries share the rank, and the next rank skips
//        (1, 2, 2, 4).
// Every comparison is exact (./rational.ts), so a tie is a real tie.
//
// Loads under plain Node: relative imports only.

import {
  addRationals,
  compareRationals,
  divideRational,
  multiplyRational,
  rational,
  type Rational,
} from "./rational";

/** Recorded on a round when it locks, so its ranking can be explained. */
export const TIE_BREAK_RULE = "criteria-by-weight-then-median-then-shared-v1";

/** A rubric criterion as scoring sees it: integer scores in a range. */
export type ScoringCriterion = {
  id: string;
  weight: number;
  minScore: number;
  maxScore: number;
};

/** One judge's scores for one entry, by criterion id. */
export type ScoreSheet = {
  judgeId: string;
  scores: Readonly<Record<string, number | undefined>>;
};

export type RankingEntry = { entryId: string; sheets: readonly ScoreSheet[] };

/** Why an entry sits below the one before it. */
export type DecidedBy =
  | "score"
  | { criterionId: string }
  | "median"
  /** Tied all the way: same rank as the entry before it. */
  | "shared";

export type RankedEntry = {
  entryId: string;
  /** Mean of the finished sheet totals, 0 to 100. */
  score: Rational;
  /** 1 for the top; shared ranks repeat and the next one skips. */
  rank: number;
  /** How many finished sheets the score averages. */
  sheetsCounted: number;
  /** Null for the first entry. */
  decidedBy: DecidedBy | null;
};

export type PartitionRanking = {
  ranked: RankedEntry[];
  /** Entries without a single finished sheet, by id. */
  unscored: string[];
};

/**
 * Whether every criterion has a score. Throws on a score the rubric can't
 * hold (out of range, not an integer, unknown criterion): scoring refuses
 * those on save, so meeting one here means the data is wrong.
 */
export function isSheetComplete(
  criteria: readonly ScoringCriterion[],
  sheet: ScoreSheet
): boolean {
  const known = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  for (const [criterionId, value] of Object.entries(sheet.scores)) {
    if (value === undefined) continue;
    const criterion = known.get(criterionId);
    if (!criterion) {
      throw new RangeError(
        `Judge ${sheet.judgeId} scored "${criterionId}", which isn't in the rubric`
      );
    }
    if (
      !Number.isInteger(value) ||
      value < criterion.minScore ||
      value > criterion.maxScore
    ) {
      throw new RangeError(
        `Judge ${sheet.judgeId} gave "${criterionId}" ${value}, outside ${criterion.minScore}-${criterion.maxScore}`
      );
    }
  }
  return criteria.every(
    (criterion) => sheet.scores[criterion.id] !== undefined
  );
}

/** A score's share of its criterion's range, 0 to 1. */
function share(criterion: ScoringCriterion, sheet: ScoreSheet): Rational {
  return rational(
    sheet.scores[criterion.id]! - criterion.minScore,
    criterion.maxScore - criterion.minScore
  );
}

/** The sheet's weighted total out of 100, or null while unfinished. */
export function sheetTotal(
  criteria: readonly ScoringCriterion[],
  sheet: ScoreSheet
): Rational | null {
  if (!isSheetComplete(criteria, sheet)) return null;
  const weights = criteria.reduce(
    (sum, criterion) => sum + criterion.weight,
    0
  );
  const weighted = addRationals(
    ...criteria.map((criterion) =>
      multiplyRational(share(criterion, sheet), criterion.weight)
    )
  );
  return divideRational(multiplyRational(weighted, 100), weights);
}

function mean(values: readonly Rational[]): Rational {
  return divideRational(addRationals(...values), values.length);
}

function median(values: readonly Rational[]): Rational {
  const sorted = [...values].sort(compareRationals);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : mean([sorted[middle - 1]!, sorted[middle]!]);
}

type Scored = {
  entryId: string;
  score: Rational;
  /** Mean share per criterion, in tie-break order. */
  criterionMeans: { criterionId: string; mean: Rational }[];
  median: Rational;
  sheetsCounted: number;
};

/** Higher weight first; equal weights keep rubric order (sort is stable). */
function tieBreakOrder(criteria: readonly ScoringCriterion[]) {
  return [...criteria].sort((a, b) => b.weight - a.weight);
}

/** The first step at which `upper` beats `lower`; "shared" if none does. */
function decide(upper: Scored, lower: Scored): DecidedBy {
  if (compareRationals(upper.score, lower.score) !== 0) return "score";
  for (const [
    index,
    { criterionId, mean: upperMean },
  ] of upper.criterionMeans.entries()) {
    const lowerMean = lower.criterionMeans[index]!.mean;
    if (compareRationals(upperMean, lowerMean) !== 0) return { criterionId };
  }
  if (compareRationals(upper.median, lower.median) !== 0) return "median";
  return "shared";
}

/** Sort comparator: better entries first, full ties by entry id. */
function better(a: Scored, b: Scored): number {
  const steps = [
    compareRationals(b.score, a.score),
    ...a.criterionMeans.map((criterion, index) =>
      compareRationals(b.criterionMeans[index]!.mean, criterion.mean)
    ),
    compareRationals(b.median, a.median),
  ];
  const byId = a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
  return steps.find((step) => step !== 0) ?? byId;
}

/** Ranks one partition's entries; see the rule at the top of this file. */
export function rankEntries(
  criteria: readonly ScoringCriterion[],
  entries: readonly RankingEntry[]
): PartitionRanking {
  if (criteria.length === 0) {
    throw new RangeError("A ranking needs a rubric with criteria");
  }
  const order = tieBreakOrder(criteria);
  const scored: Scored[] = [];
  const unscored: string[] = [];
  for (const entry of entries) {
    const finished = entry.sheets.filter((sheet) =>
      isSheetComplete(criteria, sheet)
    );
    if (finished.length === 0) {
      unscored.push(entry.entryId);
      continue;
    }
    const totals = finished.map((sheet) => sheetTotal(criteria, sheet)!);
    scored.push({
      entryId: entry.entryId,
      score: mean(totals),
      criterionMeans: order.map((criterion) => ({
        criterionId: criterion.id,
        mean: mean(finished.map((sheet) => share(criterion, sheet))),
      })),
      median: median(totals),
      sheetsCounted: finished.length,
    });
  }
  scored.sort(better);
  const ranked = scored.map((entry, index): RankedEntry => {
    const above = scored[index - 1];
    return {
      entryId: entry.entryId,
      score: entry.score,
      rank: index + 1,
      sheetsCounted: entry.sheetsCounted,
      decidedBy: above ? decide(above, entry) : null,
    };
  });
  for (const [index, entry] of ranked.entries()) {
    if (entry.decidedBy === "shared") entry.rank = ranked[index - 1]!.rank;
  }
  return { ranked, unscored: unscored.sort() };
}
