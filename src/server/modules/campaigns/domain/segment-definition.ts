// An audience segment's definition: who a campaign is for. It has four
// criteria. A person matches when every criterion that lists values
// matches (AND across criteria), and a criterion matches when any of its
// values does (OR within one). A criterion with no values doesn't filter,
// so an empty definition means everyone with communication consent.
// Consent is never a criterion: the audience planner applies it to every
// segment.
//
// The role and milestone lists belong to the access and community modules.
// The schema is built from the lists it is given, so this file depends on
// neither.
//
// Pure: loads under plain Node (schema, seed), relative imports only.

import { z } from "zod";

export const SEGMENT_LIMITS = {
  /** Values one criterion may list. */
  valuesPerCriterion: 50,
  /** Characters in one city name, after trimming. */
  cityLength: 80,
} as const;

export type SegmentDefinition<
  Role extends string = string,
  Milestone extends string = string,
> = {
  roles: Role[];
  /** As entered, trimmed and with inner spaces collapsed. */
  cities: string[];
  competitionIds: string[];
  milestones: Milestone[];
};

/** The attributes of one person that a definition is matched against. */
export type SegmentAttributes = {
  roles: readonly string[];
  cities: readonly string[];
  competitionIds: readonly string[];
  milestones: readonly string[];
};

/**
 * How cities compare: "  New   Delhi " and "new delhi" are one city.
 * Both stored definitions and people's cities go through this.
 */
export function normaliseCity(city: string): string {
  return tidyCity(city).toLocaleLowerCase("en-IN");
}

function tidyCity(city: string): string {
  return city.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/** Each value once, in the order of `order`. */
function inOrder<T extends string>(values: readonly T[], order: readonly T[]) {
  const wanted = new Set(values);
  return order.filter((value) => wanted.has(value));
}

/** Each city once (first spelling kept), sorted by its compared form. */
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

/** Each id once, lower-cased and sorted. */
function canonicalIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))].toSorted();
}

/**
 * The zod schema for a definition, given every role and milestone there
 * is. It refuses unknown values and keys, and returns the definition in a
 * canonical form: each value once, roles and milestones in list order,
 * cities and competitions sorted. Two definitions that select the same
 * people by the same values come out deep-equal.
 */
export function segmentDefinitionSchema<
  const Role extends string,
  const Milestone extends string,
>(lists: {
  roles: readonly [Role, ...Role[]];
  milestones: readonly [Milestone, ...Milestone[]];
}) {
  const list = <T extends z.ZodType>(item: T) =>
    z.array(item).max(SEGMENT_LIMITS.valuesPerCriterion).default([]);
  return z
    .strictObject({
      roles: list(z.enum(lists.roles)),
      cities: list(
        z
          .string()
          .transform(tidyCity)
          .pipe(z.string().min(1).max(SEGMENT_LIMITS.cityLength))
      ),
      competitionIds: list(z.uuid()),
      milestones: list(z.enum(lists.milestones)),
    })
    .transform((input): SegmentDefinition<Role, Milestone> => ({
      roles: inOrder<Role>(input.roles as Role[], lists.roles),
      cities: canonicalCities(input.cities),
      competitionIds: canonicalIds(input.competitionIds),
      milestones: inOrder<Milestone>(
        input.milestones as Milestone[],
        lists.milestones
      ),
    }));
}

/** Whether the definition filters nobody out (everyone consented). */
export function isUnfiltered(definition: SegmentDefinition): boolean {
  return (
    definition.roles.length === 0 &&
    definition.cities.length === 0 &&
    definition.competitionIds.length === 0 &&
    definition.milestones.length === 0
  );
}

function anyOf(
  wanted: readonly string[],
  has: readonly string[],
  key: (value: string) => string = (value) => value
): boolean {
  if (wanted.length === 0) return true;
  const held = new Set(has.map(key));
  return wanted.some((value) => held.has(key(value)));
}

/** Whether a person with `attributes` is in the segment, consent aside. */
export function matchesSegment(
  definition: SegmentDefinition,
  attributes: SegmentAttributes
): boolean {
  return (
    anyOf(definition.roles, attributes.roles) &&
    anyOf(definition.cities, attributes.cities, normaliseCity) &&
    anyOf(definition.competitionIds, attributes.competitionIds, (id) =>
      id.toLowerCase()
    ) &&
    anyOf(definition.milestones, attributes.milestones)
  );
}
