/**
 * Judging levels and the seeded rubric. FoA.md Phase 9: School → City/District
 * → State → National → Global, "not every level initially"; SPEC §7.2 opens
 * the school round (school route only) and the FOA round (NATIONAL, final).
 * Rubric weights: SPEC §7.1.
 */
export const JUDGING_LEVELS = [
  { key: "SCHOOL", active: true },
  { key: "CITY", active: false },
  { key: "STATE", active: false },
  { key: "NATIONAL", active: true },
  { key: "GLOBAL", active: false },
] as const;

export type JudgingLevel = (typeof JUDGING_LEVELS)[number]["key"];

export const RUBRIC = [
  { key: "theme", weight: 30 },
  { key: "creativity", weight: 25 },
  { key: "technique", weight: 25 },
  { key: "presentation", weight: 20 },
] as const;
