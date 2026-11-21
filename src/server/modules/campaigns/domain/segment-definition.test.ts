import { describe, expect, it } from "vitest";

import {
  SEGMENT_LIMITS,
  isUnfiltered,
  matchesSegment,
  normaliseCity,
  segmentDefinitionSchema,
  type SegmentAttributes,
  type SegmentDefinition,
} from "./segment-definition";

// Stand-ins for the access module's roles and the community ladder.
const ROLES = ["member", "guardian", "volunteer", "community_manager"] as const;
const MILESTONES = ["participant", "school_winner", "volunteer"] as const;

const schema = segmentDefinitionSchema({
  roles: ROLES,
  milestones: MILESTONES,
});

const COMPETITION_A = "01938a00-0000-7000-8000-00000000a001";
const COMPETITION_B = "01938a00-0000-7000-8000-00000000b002";

const EMPTY: SegmentDefinition = {
  roles: [],
  cities: [],
  competitionIds: [],
  milestones: [],
};

const NOBODY: SegmentAttributes = {
  roles: [],
  cities: [],
  competitionIds: [],
  milestones: [],
};

describe("segmentDefinitionSchema", () => {
  it("reads a missing criterion as no filter", () => {
    expect(schema.parse({})).toEqual(EMPTY);
    expect(schema.parse({ roles: ["guardian"] })).toEqual({
      ...EMPTY,
      roles: ["guardian"],
    });
  });

  it("lists each value once, roles and milestones in list order", () => {
    expect(
      schema.parse({
        roles: ["volunteer", "member", "volunteer"],
        milestones: ["volunteer", "participant"],
      })
    ).toEqual({
      ...EMPTY,
      roles: ["member", "volunteer"],
      milestones: ["participant", "volunteer"],
    });
  });

  it("tidies cities, keeps the first spelling and sorts them", () => {
    expect(
      schema.parse({ cities: ["  Pune ", "new   delhi", "PUNE", "Mumbai"] })
        .cities
    ).toEqual(["Mumbai", "new delhi", "Pune"]);
  });

  it("lower-cases, dedupes and sorts competition ids", () => {
    expect(
      schema.parse({
        competitionIds: [COMPETITION_B, COMPETITION_A.toUpperCase()],
      }).competitionIds
    ).toEqual([COMPETITION_A, COMPETITION_B]);
  });

  it("gives the same definition for the same people however it was typed", () => {
    const one = schema.parse({
      roles: ["guardian", "member"],
      cities: ["Pune", "Mumbai"],
    });
    const two = schema.parse({
      cities: ["mumbai ", " PUNE", "Mumbai"],
      roles: ["member", "guardian", "member"],
      milestones: [],
    });
    expect(two).toEqual({ ...one, cities: ["mumbai", "PUNE"] });
    expect(two.cities.map(normaliseCity)).toEqual(
      one.cities.map(normaliseCity)
    );
  });

  it.each([
    ["an unknown role", { roles: ["auction_manager"] }],
    ["an unknown milestone", { milestones: ["ambassador"] }],
    ["an unknown key", { schools: ["x"] }],
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
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("accepts a city at the length limit", () => {
    const city = "x".repeat(SEGMENT_LIMITS.cityLength);
    expect(schema.parse({ cities: [`  ${city}  `] }).cities).toEqual([city]);
  });
});

describe("isUnfiltered", () => {
  it("is true only when no criterion lists a value", () => {
    expect(isUnfiltered(EMPTY)).toBe(true);
    expect(isUnfiltered({ ...EMPTY, cities: ["Pune"] })).toBe(false);
    expect(isUnfiltered({ ...EMPTY, milestones: ["volunteer"] })).toBe(false);
  });
});

describe("normaliseCity", () => {
  it("ignores case, outer spaces and repeated inner spaces", () => {
    expect(normaliseCity("  New \t Delhi ")).toBe("new delhi");
  });

  it("compares composed and decomposed accents as one city", () => {
    expect(normaliseCity("Belém")).toBe(normaliseCity("Belém"));
  });
});

describe("matchesSegment", () => {
  const asha: SegmentAttributes = {
    roles: ["member", "guardian"],
    cities: ["Pune"],
    competitionIds: [COMPETITION_A],
    milestones: ["participant"],
  };

  it("matches everyone when no criterion lists a value", () => {
    expect(matchesSegment(EMPTY, asha)).toBe(true);
    expect(matchesSegment(EMPTY, NOBODY)).toBe(true);
  });

  it("matches when any value of a criterion matches (OR within)", () => {
    expect(
      matchesSegment({ ...EMPTY, roles: ["volunteer", "guardian"] }, asha)
    ).toBe(true);
    expect(matchesSegment({ ...EMPTY, roles: ["volunteer"] }, asha)).toBe(
      false
    );
  });

  it("needs every criterion that lists values to match (AND across)", () => {
    const both: SegmentDefinition = {
      ...EMPTY,
      roles: ["guardian"],
      cities: ["Pune"],
    };
    expect(matchesSegment(both, asha)).toBe(true);
    expect(matchesSegment(both, { ...asha, cities: ["Mumbai"] })).toBe(false);
    expect(matchesSegment(both, { ...asha, roles: ["member"] })).toBe(false);
  });

  it("leaves out a person with no value for a filtering criterion", () => {
    expect(matchesSegment({ ...EMPTY, cities: ["Pune"] }, NOBODY)).toBe(false);
    expect(
      matchesSegment({ ...EMPTY, competitionIds: [COMPETITION_A] }, NOBODY)
    ).toBe(false);
  });

  it("compares cities the way normaliseCity does", () => {
    expect(
      matchesSegment(
        { ...EMPTY, cities: ["new delhi"] },
        { ...NOBODY, cities: [" New  Delhi"] }
      )
    ).toBe(true);
  });

  it("compares competition ids whatever their case", () => {
    expect(
      matchesSegment(
        { ...EMPTY, competitionIds: [COMPETITION_A] },
        { ...NOBODY, competitionIds: [COMPETITION_A.toUpperCase()] }
      )
    ).toBe(true);
  });

  it("matches milestones by rung", () => {
    const winners: SegmentDefinition = {
      ...EMPTY,
      milestones: ["school_winner"],
    };
    expect(matchesSegment(winners, asha)).toBe(false);
    expect(
      matchesSegment(winners, { ...asha, milestones: ["school_winner"] })
    ).toBe(true);
  });
});
