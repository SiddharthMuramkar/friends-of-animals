// A segment's definition: who a campaign is for (#126). It is built over
// data the platform already holds, and every criterion is optional:
//
//   - roles:          the person holds a grant of the role, at any scope;
//   - competitionIds: the person is connected to the competition: they or
//                     their child are registered for it, or their
//                     institution is;
//   - cities:         the city on the person's own profile (or their
//                     child's), or of an institution they look after.
//
// A person matches when every criterion that lists values matches (AND
// across criteria), and a criterion matches when any of its values does
// (OR within one). An empty definition is everyone. Consent is never a
// criterion: the audience planner (./audience.ts) applies it to every
// segment, so a segment only ever holds people with current consent.
//
// Extension point (#119): community membership adds a criterion here, for
// example `milestones` from the engagement ladder. Add its key to
// SEGMENT_CRITERIA, its values to the schema below, and its loader beside
// the others in ../load-audience.ts; TypeScript then names every place a
// definition or a person's attributes must carry it. Community members
// with an account are already candidates; only people without one would
// need a new candidate source in ../load-audience.ts.
//
// Pure: loads under plain Node (schema, seed), relative imports only.

import { z } from "zod";

import type { Role } from "../../../access/domain/roles";

export const SEGMENT_CRITERIA = ["roles", "competitionIds", "cities"] as const;
export type SegmentCriterion = (typeof SEGMENT_CRITERIA)[number];

/**
 * The roles a segment can name: the community's, not FOA's staff, whose
 * news isn't a campaign. Only grants count, so a role names accounts, never
 * a child without one.
 */
export const SEGMENT_ROLES = [
  "guardian",
  "institution_admin",
  "institution_coordinator",
  "judge",
  "volunteer",
  "organisation_representative",
] as const satisfies readonly Role[];
export type SegmentRole = (typeof SEGMENT_ROLES)[number];

export const SEGMENT_LIMITS = {
  /** Values one criterion may list. */
  valuesPerCriterion: 50,
  /** Characters in one city name, after tidying. */
  cityLength: 80,
} as const;

export type SegmentDefinition = {
  roles: SegmentRole[];
  /** Lower-cased and sorted. */
  competitionIds: string[];
  /** Tidied as entered, each city once, sorted by its compared form. */
  cities: string[];
};

/** What one person is matched on, criterion by criterion. */
export type SegmentAttributes = {
  [Criterion in SegmentCriterion]: readonly string[];
};

function tidyCity(city: string): string {
  return city.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/** How cities compare: "  New   Delhi " and "new delhi" are one city. */
export function normaliseCity(city: string): string {
  return tidyCity(city).toLocaleLowerCase("en-IN");
}

function canonicalCities(cities: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  for (const city of cities) {
    const key = normaliseCity(city);
    if (!byKey.has(key)) byKey.set(key, tidyCity(city));
  }
  return [...byKey.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, city]) => city);
}

const list = <T extends z.ZodType>(item: T) =>
  z.array(item).max(SEGMENT_LIMITS.valuesPerCriterion).default([]);

/**
 * Parses a definition from a form or a stored row, refusing unknown values
 * and keys, into its canonical form: each value once, roles in catalogue
 * order, competitions and cities sorted.
 */
export const segmentDefinitionSchema = z
  .strictObject({
    roles: list(z.enum(SEGMENT_ROLES)),
    competitionIds: list(z.uuid()),
    cities: list(
      z
        .string()
        .transform(tidyCity)
        .pipe(z.string().min(1).max(SEGMENT_LIMITS.cityLength))
    ),
  })
  .transform((input): SegmentDefinition => ({
    roles: SEGMENT_ROLES.filter((role) => input.roles.includes(role)),
    competitionIds: [
      ...new Set(input.competitionIds.map((id) => id.toLowerCase())),
    ].toSorted(),
    cities: canonicalCities(input.cities),
  }));

/** Whether the definition filters nobody out: everyone who consented. */
export function isUnfiltered(definition: SegmentDefinition): boolean {
  return SEGMENT_CRITERIA.every(
    (criterion) => definition[criterion].length === 0
  );
}

/** How each criterion's values compare. */
const COMPARED: Record<SegmentCriterion, (value: string) => string> = {
  roles: (value) => value,
  competitionIds: (value) => value.toLowerCase(),
  cities: normaliseCity,
};

/** Whether a person with `attributes` is in the segment, consent aside. */
export function matchesSegment(
  definition: SegmentDefinition,
  attributes: SegmentAttributes
): boolean {
  return SEGMENT_CRITERIA.every((criterion) => {
    const wanted: readonly string[] = definition[criterion];
    if (wanted.length === 0) return true;
    const key = COMPARED[criterion];
    const held = new Set(attributes[criterion].map(key));
    return wanted.some((value) => held.has(key(value)));
  });
}
