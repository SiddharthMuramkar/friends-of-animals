import { describe, expect, it } from "vitest";

import {
  AWARD_BANDS,
  AWARD_SCHEMES,
  DEFAULT_AWARD_SCHEME,
  awardPlan,
  decideRoundAwards,
  offeredRounds,
} from "./award-schemes";

describe("award schemes", () => {
  it("offers ranked, medals and grades, ranked 1st/2nd/3rd by default", () => {
    expect(AWARD_SCHEMES).toEqual(["ranked_123", "medals_gsb", "grades_ab"]);
    expect(DEFAULT_AWARD_SCHEME).toBe("ranked_123");
  });

  it("gives each scheme its bands, best first", () => {
    expect(AWARD_BANDS).toEqual({
      ranked_123: ["first", "second", "third"],
      medals_gsb: ["gold", "silver", "bronze"],
      grades_ab: ["grade_a", "grade_b"],
    });
  });
});

describe("offeredRounds", () => {
  it("always has the FOA final, and a school round only with institutions", () => {
    expect(offeredRounds("individuals")).toEqual(["foa_final"]);
    expect(offeredRounds("institutions")).toEqual(["school", "foa_final"]);
    expect(offeredRounds("both")).toEqual(["school", "foa_final"]);
  });
});

describe("awardPlan", () => {
  it("defaults every offered round to ranked 1st/2nd/3rd with no prizes", () => {
    expect(awardPlan("both", [])).toEqual([
      {
        roundKey: "school",
        scheme: "ranked_123",
        bands: [
          { band: "first", prize: null },
          { band: "second", prize: null },
          { band: "third", prize: null },
        ],
      },
      {
        roundKey: "foa_final",
        scheme: "ranked_123",
        bands: [
          { band: "first", prize: null },
          { band: "second", prize: null },
          { band: "third", prize: null },
        ],
      },
    ]);
  });

  it("uses a round's stored scheme and prizes", () => {
    expect(
      awardPlan("individuals", [
        {
          roundKey: "foa_final",
          scheme: "medals_gsb",
          prizes: { gold: "Trophy and certificate" },
        },
      ])
    ).toEqual([
      {
        roundKey: "foa_final",
        scheme: "medals_gsb",
        bands: [
          { band: "gold", prize: "Trophy and certificate" },
          { band: "silver", prize: null },
          { band: "bronze", prize: null },
        ],
      },
    ]);
  });

  it("leaves out a stored round the competition no longer offers", () => {
    expect(
      awardPlan("individuals", [
        { roundKey: "school", scheme: "grades_ab", prizes: {} },
      ]).map((round) => round.roundKey)
    ).toEqual(["foa_final"]);
  });

  it("ignores a stored prize for a band its scheme doesn't have", () => {
    const [final] = awardPlan("individuals", [
      { roundKey: "foa_final", scheme: "grades_ab", prizes: { gold: "Cup" } },
    ]);
    expect(final?.bands).toEqual([
      { band: "grade_a", prize: null },
      { band: "grade_b", prize: null },
    ]);
  });
});

describe("decideRoundAwards", () => {
  it("stores a scheme with trimmed prizes and drops empty ones", () => {
    expect(
      decideRoundAwards("both", {
        roundKey: "school",
        scheme: "grades_ab",
        prizes: { grade_a: "  Trophy  ", grade_b: "   " },
      })
    ).toEqual({
      ok: true,
      value: {
        roundKey: "school",
        scheme: "grades_ab",
        prizes: { grade_a: "Trophy" },
      },
    });
  });

  it("refuses a prize for a band the scheme doesn't have", () => {
    expect(
      decideRoundAwards("both", {
        roundKey: "foa_final",
        scheme: "ranked_123",
        prizes: { gold: "Cup" },
      })
    ).toEqual({ ok: false, error: "band_not_in_scheme" });
  });

  it("refuses a school round when no institution takes part", () => {
    expect(
      decideRoundAwards("individuals", {
        roundKey: "school",
        scheme: "ranked_123",
        prizes: {},
      })
    ).toEqual({ ok: false, error: "round_not_offered" });
  });

  it("refuses an unknown round or scheme", () => {
    expect(
      decideRoundAwards("both", {
        roundKey: "state",
        scheme: "ranked_123",
        prizes: {},
      })
    ).toEqual({ ok: false, error: "unknown_round" });
    expect(
      decideRoundAwards("both", {
        roundKey: "foa_final",
        scheme: "stars",
        prizes: {},
      })
    ).toEqual({ ok: false, error: "unknown_scheme" });
  });

  it("counts a Devanagari conjunct as one character", () => {
    // "क्ष" is three code points but one character on screen.
    expect(
      decideRoundAwards("both", {
        roundKey: "foa_final",
        scheme: "ranked_123",
        prizes: { first: "क्ष".repeat(200) },
      }).ok
    ).toBe(true);
  });

  it("refuses a prize text over 200 characters", () => {
    expect(
      decideRoundAwards("both", {
        roundKey: "foa_final",
        scheme: "ranked_123",
        prizes: { first: "x".repeat(201) },
      })
    ).toEqual({ ok: false, error: "prize_too_long" });
    expect(
      decideRoundAwards("both", {
        roundKey: "foa_final",
        scheme: "ranked_123",
        prizes: { first: "x".repeat(200) },
      }).ok
    ).toBe(true);
  });
});
