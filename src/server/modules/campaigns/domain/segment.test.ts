import { describe, expect, it } from "vitest";

import {
  isUnfiltered,
  matchesSegment,
  normaliseCity,
  SEGMENT_LIMITS,
  segmentDefinitionSchema,
  type SegmentAttributes,
  type SegmentDefinition,
} from "./segment";

const COMPETITION_A = "01938a00-0000-7000-8000-00000000a001";
const COMPETITION_B = "01938a00-0000-7000-8000-00000000b002";

const EVERYONE: SegmentDefinition = {
  roles: [],
  competitionIds: [],
  cities: [],
};

const NOBODY_IN_PARTICULAR: SegmentAttributes = {
  roles: [],
  competitionIds: [],
  cities: [],
};

describe("segmentDefinitionSchema", () => {
  it("reads a missing criterion as no filter", () => {
    expect(segmentDefinitionSchema.parse({})).toEqual(EVERYONE);
    expect(segmentDefinitionSchema.parse({ roles: ["guardian"] })).toEqual({
      ...EVERYONE,
      roles: ["guardian"],
    });
  });

  it("lists each role once, in the catalogue's order", () => {
    expect(
      segmentDefinitionSchema.parse({
        roles: ["volunteer", "guardian", "volunteer"],
      }).roles
    ).toEqual(["guardian", "volunteer"]);
  });

  it("tidies cities, keeps the first spelling and sorts them", () => {
    expect(
      segmentDefinitionSchema.parse({
        cities: ["  Pune ", "new   delhi", "PUNE", "Mumbai"],
      }).cities
    ).toEqual(["Mumbai", "new delhi", "Pune"]);
  });

  it("lower-cases, dedupes and sorts competition ids", () => {
    expect(
      segmentDefinitionSchema.parse({
        competitionIds: [COMPETITION_B, COMPETITION_A.toUpperCase()],
      }).competitionIds
    ).toEqual([COMPETITION_A, COMPETITION_B]);
  });

  it.each([
    ["a staff role", { roles: ["community_manager"] }],
    ["a role that doesn't exist", { roles: ["ambassador"] }],
    ["an unknown criterion", { unsupported: ["volunteer"] }],
    ["an unknown milestone", { milestones: ["never_a_rung"] }],
    ["a blank city", { cities: ["   "] }],
    [
      "a city that is too long",
      { cities: ["x".repeat(SEGMENT_LIMITS.cityLength + 1)] },
    ],
    ["a competition id that isn't a UUID", { competitionIds: ["42"] }],
    [
      "too many values in one criterion",
      {
        cities: Array.from(
          { length: SEGMENT_LIMITS.valuesPerCriterion + 1 },
          (_, n) => `City ${n}`
        ),
      },
    ],
  ])("refuses %s", (_, input) => {
    expect(segmentDefinitionSchema.safeParse(input).success).toBe(false);
  });
});

describe("matchesSegment", () => {
  it("lets everyone through an empty definition", () => {
    expect(isUnfiltered(EVERYONE)).toBe(true);
    expect(matchesSegment(EVERYONE, NOBODY_IN_PARTICULAR)).toBe(true);
  });

  it("needs any one value of a criterion (OR within it)", () => {
    const definition: SegmentDefinition = {
      ...EVERYONE,
      roles: ["guardian", "volunteer"],
    };
    expect(isUnfiltered(definition)).toBe(false);
    expect(
      matchesSegment(definition, {
        ...NOBODY_IN_PARTICULAR,
        roles: ["volunteer"],
      })
    ).toBe(true);
    expect(
      matchesSegment(definition, { ...NOBODY_IN_PARTICULAR, roles: ["judge"] })
    ).toBe(false);
  });

  it("needs every criterion that lists values (AND across them)", () => {
    const definition: SegmentDefinition = {
      ...EVERYONE,
      competitionIds: [COMPETITION_A],
      cities: ["Pune"],
    };
    expect(
      matchesSegment(definition, {
        ...NOBODY_IN_PARTICULAR,
        competitionIds: [COMPETITION_A],
        cities: ["Pune"],
      })
    ).toBe(true);
    expect(
      matchesSegment(definition, {
        ...NOBODY_IN_PARTICULAR,
        competitionIds: [COMPETITION_A],
        cities: ["Mumbai"],
      })
    ).toBe(false);
  });

  it("compares cities however they are spelt", () => {
    expect(normaliseCity("  New   Delhi ")).toBe(normaliseCity("new delhi"));
    expect(
      matchesSegment(
        { ...EVERYONE, cities: ["New Delhi"] },
        { ...NOBODY_IN_PARTICULAR, cities: [" new  DELHI"] }
      )
    ).toBe(true);
  });
});
