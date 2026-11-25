// The rules for one category's shortlist in a school round. Pure: the use
// cases load the round's entries and the competition's limits, call
// `checkCategoryPicks`, and store the picks only when it says they are fine.
// Coordinator-created entries in the shortlist-only scope and closing a
// round on the school's behalf go through the same function.
//
// A pick is a shortlisted entry. A school position is an optional attribute
// of a pick, so every positioned entry is also shortlisted.

/** An entry of the round, as far as picking is concerned. */
export type PickCandidate = {
  entryId: string;
  /** The competition category the entry is in. */
  categoryId: string;
  /** Only entries that reached `submitted` can be shortlisted. */
  submitted: boolean;
};

/** One shortlisted entry, with its school position if it has one. */
export type Pick = {
  entryId: string;
  /** 1 is first place. `null` means shortlisted without a position. */
  position: number | null;
};

/** From the competition's settings. */
export type ShortlistLimits = {
  /** Most entries a school shortlists per category. */
  shortlistSize: number;
  /** How many school positions it may declare per category. */
  positions: number;
};

/** Why a shortlist can't be saved. Each names what the form should flag. */
export type PickProblem =
  /** The entry isn't one of this round's entries. */
  | { code: "unknown_entry"; entryId: string }
  /** The entry is in another category. */
  | { code: "wrong_category"; entryId: string }
  /** The entry never reached `submitted`. */
  | { code: "not_submitted"; entryId: string }
  /** The entry is picked more than once. */
  | { code: "duplicate_entry"; entryId: string }
  /** More picks than the competition's shortlist size. */
  | { code: "shortlist_full"; limit: number; count: number }
  /** Not a whole number from 1 to `availablePositions(limits)`. */
  | {
      code: "position_out_of_range";
      entryId: string;
      position: number;
      limit: number;
    }
  /** Another entry in the category already holds this position. */
  | { code: "position_taken"; entryId: string; position: number };

export type CategoryPicksCheck =
  | { ok: true; picks: Pick[] }
  | { ok: false; problems: PickProblem[] };

/**
 * Throws a RangeError unless the limits make sense: at least one shortlisted
 * entry, and no negative number of positions. Competition settings are
 * validated when published, so this only catches a bug.
 */
function assertLimits({ shortlistSize, positions }: ShortlistLimits): void {
  if (!Number.isInteger(shortlistSize) || shortlistSize < 1) {
    throw new RangeError(
      `shortlistSize must be a whole number of at least 1, not ${shortlistSize}`
    );
  }
  if (!Number.isInteger(positions) || positions < 0) {
    throw new RangeError(
      `positions must be a whole number of at least 0, not ${positions}`
    );
  }
}

/**
 * The positions a school can actually declare per category: the
 * competition's number, but never more than its shortlist size, because
 * only shortlisted entries hold a position. (A competition may be saved
 * with more positions than shortlisted entries.)
 */
export function availablePositions(limits: ShortlistLimits): number {
  return Math.min(limits.positions, limits.shortlistSize);
}

/**
 * Checks a whole category's shortlist against the round's entries and the
 * competition's limits. Reports every problem at once, in the order of the
 * picks, so the form can flag each entry. Throws a RangeError if the limits
 * themselves are impossible.
 */
export function checkCategoryPicks(input: {
  categoryId: string;
  /** Every entry of the round, in any category. */
  candidates: readonly PickCandidate[];
  picks: readonly Pick[];
  limits: ShortlistLimits;
}): CategoryPicksCheck {
  assertLimits(input.limits);
  const positionLimit = availablePositions(input.limits);
  const candidates = new Map(
    input.candidates.map((candidate) => [candidate.entryId, candidate])
  );
  const problems: PickProblem[] = [];
  const seen = new Set<string>();
  const taken = new Set<number>();

  for (const { entryId, position } of input.picks) {
    const candidate = candidates.get(entryId);
    if (seen.has(entryId)) {
      problems.push({ code: "duplicate_entry", entryId });
    } else if (!candidate) {
      problems.push({ code: "unknown_entry", entryId });
    } else if (candidate.categoryId !== input.categoryId) {
      problems.push({ code: "wrong_category", entryId });
    } else if (!candidate.submitted) {
      problems.push({ code: "not_submitted", entryId });
    }
    seen.add(entryId);

    if (position === null) continue;
    if (
      !Number.isInteger(position) ||
      position < 1 ||
      position > positionLimit
    ) {
      problems.push({
        code: "position_out_of_range",
        entryId,
        position,
        limit: positionLimit,
      });
    } else if (taken.has(position)) {
      problems.push({ code: "position_taken", entryId, position });
    } else {
      taken.add(position);
    }
  }

  if (seen.size > input.limits.shortlistSize) {
    problems.push({
      code: "shortlist_full",
      limit: input.limits.shortlistSize,
      count: seen.size,
    });
  }

  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, picks: [...input.picks] };
}
