// What a competition manager chooses for an FOA judging round (#95): its
// name, level, whether it judges the physical artwork, and where its
// entries come from. The award scheme is added from the competition's
// award-scheme setting when the round is created.
//
// Defaults follow the pilot: a single national round judged on the
// physical artwork, fed by FOA-verified entries.
//
// Loads under plain Node (schema file, seed script): relative imports only.

import { z } from "zod";

/** The levels a round judges at, smallest first. */
export const JUDGING_LEVELS = [
  "city_district",
  "state",
  "national",
  "global",
] as const;

export type JudgingLevel = (typeof JUDGING_LEVELS)[number];

/**
 * Where a round's pool comes from: FOA-verified entries, or the finalists
 * of an earlier round. Finalists are available only once the source round is locked.
 */
export const ROUND_ENTRY_SOURCES = [
  "verified_entries",
  "round_finalists",
] as const;

export type RoundEntrySource = (typeof ROUND_ENTRY_SOURCES)[number];

export const DEFAULT_ROUND_SETTINGS = {
  level: "national",
  judgesPhysical: true,
  entrySource: "verified_entries",
} as const satisfies {
  level: JudgingLevel;
  judgesPhysical: boolean;
  entrySource: RoundEntrySource;
};

const MAX_NAME_LENGTH = 120;

/** A round's settings from untrusted input, with the defaults filled in. */
export const roundSettingsSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    level: z.enum(JUDGING_LEVELS).default(DEFAULT_ROUND_SETTINGS.level),
    judgesPhysical: z.boolean().default(DEFAULT_ROUND_SETTINGS.judgesPhysical),
    entrySource: z
      .enum(ROUND_ENTRY_SOURCES)
      .default(DEFAULT_ROUND_SETTINGS.entrySource),
    sourceRoundId: z.uuid().nullable().optional(),
  })
  .refine(
    (s) => (s.entrySource === "round_finalists") === (s.sourceRoundId != null),
    {
      path: ["sourceRoundId"],
      message: "Entry source and source round must agree",
    }
  );

export type RoundSettings = z.infer<typeof roundSettingsSchema>;

/**
 * How two round names compare: trimmed, inner spaces collapsed and lower
 * case, so "All India Final" and "all  india final" are one name within a
 * competition.
 */
export function roundNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
