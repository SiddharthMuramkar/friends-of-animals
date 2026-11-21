// Award schemes (#72): how each round recognises its best entries, and the
// prize, if any, behind each award. Rounds themselves arrive later (school
// round #89, FOA rounds #95/#99), so a scheme is kept per planned round:
// the school round and the FOA final (the pilot's plan in #55). Later FOA
// rounds take the final's scheme as their default. The default everywhere
// is ranked 1st, 2nd and 3rd (#55).
//
// Plain TypeScript with type-only relative imports, so the schema file and
// the seed script can load it under plain Node.

import type { Participation } from "./fees";

export const AWARD_SCHEMES = ["ranked_123", "medals_gsb", "grades_ab"] as const;

export type AwardScheme = (typeof AWARD_SCHEMES)[number];

export const DEFAULT_AWARD_SCHEME: AwardScheme = "ranked_123";

/**
 * Each scheme's awards, best first. Labels ("1st", "Gold", "A grade") are
 * copy, so they live in messages, keyed by band.
 */
export const AWARD_BANDS = {
  ranked_123: ["first", "second", "third"],
  medals_gsb: ["gold", "silver", "bronze"],
  grades_ab: ["grade_a", "grade_b"],
} as const satisfies Record<AwardScheme, readonly string[]>;

export type AwardBand = (typeof AWARD_BANDS)[AwardScheme][number];

/** The rounds a scheme can be set for, in the order they run. */
export const AWARD_ROUNDS = ["school", "foa_final"] as const;

export type AwardRound = (typeof AWARD_ROUNDS)[number];

/** The longest prize text, in characters. */
export const MAX_PRIZE_LENGTH = 200;

/**
 * The rounds a competition runs: the FOA final always, and a school round
 * only when institutions take part (individual entries skip it, #55).
 */
export function offeredRounds(participation: Participation): AwardRound[] {
  return participation === "individuals"
    ? ["foa_final"]
    : ["school", "foa_final"];
}

export type Prizes = Partial<Record<AwardBand, string>>;

/** A round's stored scheme (no row = the default, with no prizes). */
export type StoredRoundAwards = {
  roundKey: AwardRound;
  scheme: AwardScheme;
  prizes: Prizes;
};

export type RoundAwardPlan = {
  roundKey: AwardRound;
  scheme: AwardScheme;
  bands: { band: AwardBand; prize: string | null }[];
};

/**
 * The scheme and prizes of every round the competition runs, as the admin
 * form and the public page show them. A round with nothing stored gets the
 * default scheme; a stored prize for a band the scheme lacks is ignored.
 */
export function awardPlan(
  participation: Participation,
  stored: readonly StoredRoundAwards[]
): RoundAwardPlan[] {
  return offeredRounds(participation).map((roundKey) => {
    const row = stored.find((candidate) => candidate.roundKey === roundKey);
    const scheme = row?.scheme ?? DEFAULT_AWARD_SCHEME;
    const bands: readonly AwardBand[] = AWARD_BANDS[scheme];
    return {
      roundKey,
      scheme,
      bands: bands.map((band) => ({ band, prize: row?.prizes[band] ?? null })),
    };
  });
}

export type RoundAwardsInput = {
  roundKey: string;
  scheme: string;
  prizes: Partial<Record<string, string>>;
};

export type RoundAwardsError =
  | "unknown_round"
  | "unknown_scheme"
  | "round_not_offered"
  | "band_not_in_scheme"
  | "prize_too_long";

const isRound = (value: string): value is AwardRound =>
  (AWARD_ROUNDS as readonly string[]).includes(value);

const isScheme = (value: string): value is AwardScheme =>
  (AWARD_SCHEMES as readonly string[]).includes(value);

// Counts what a reader sees as characters, so a Devanagari conjunct or an
// emoji counts once.
const graphemes = new Intl.Segmenter("en-IN", { granularity: "grapheme" });
const characterCount = (text: string): number =>
  Array.from(graphemes.segment(text)).length;

/**
 * Decides what to store for one round: its scheme and the non-empty,
 * trimmed prize per band. Switching scheme stores only the new scheme's
 * bands, so prizes for the old bands go.
 */
export function decideRoundAwards(
  participation: Participation,
  input: RoundAwardsInput
):
  | { ok: true; value: StoredRoundAwards }
  | { ok: false; error: RoundAwardsError } {
  if (!isRound(input.roundKey)) return { ok: false, error: "unknown_round" };
  if (!isScheme(input.scheme)) return { ok: false, error: "unknown_scheme" };
  const roundKey = input.roundKey;
  const scheme = input.scheme;
  if (!offeredRounds(participation).includes(roundKey)) {
    return { ok: false, error: "round_not_offered" };
  }
  const bands: readonly string[] = AWARD_BANDS[scheme];
  const prizes: Prizes = {};
  for (const [band, text] of Object.entries(input.prizes)) {
    const prize = text?.trim() ?? "";
    if (prize === "") continue;
    if (!bands.includes(band))
      return { ok: false, error: "band_not_in_scheme" };
    if (characterCount(prize) > MAX_PRIZE_LENGTH) {
      return { ok: false, error: "prize_too_long" };
    }
    prizes[band as AwardBand] = prize;
  }
  return { ok: true, value: { roundKey, scheme, prizes } };
}
