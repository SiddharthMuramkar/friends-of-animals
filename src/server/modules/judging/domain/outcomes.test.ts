import { describe, expect, it } from "vitest";
import { AWARD_SCHEMES } from "../../competitions/domain/award-schemes";

import {
  advances,
  outcomeTagProblems,
  prefillOutcomes,
  ROUND_OUTCOMES,
  type OutcomeTag,
} from "./outcomes";

const tag = (
  entryId: string,
  outcome: OutcomeTag["outcome"],
  awardPosition: number | null = null,
  suitableForAuction = false
): OutcomeTag => ({ entryId, outcome, awardPosition, suitableForAuction });

describe("the outcome model", () => {
  it("has one outcome per entry and three award schemes", () => {
    expect(ROUND_OUTCOMES).toEqual([
      "winner",
      "runner_up",
      "finalist",
      "special_mention",
      "none",
    ]);
    expect(AWARD_SCHEMES).toEqual(["ranked_123", "medals_gsb", "grades_ab"]);
  });

  it("sends winners, runners-up and finalists on to a next round", () => {
    expect(ROUND_OUTCOMES.filter(advances)).toEqual([
      "winner",
      "runner_up",
      "finalist",
    ]);
  });
});

describe("prefillOutcomes()", () => {
  const ranked = [
    { entryId: "a", rank: 1 },
    { entryId: "b", rank: 2 },
    { entryId: "c", rank: 3 },
    { entryId: "d", rank: 3 },
    { entryId: "e", rank: 5 },
  ];

  it.each(["ranked_123", "medals_gsb"] as const)(
    "under %s, makes the top three ranks winner and runners-up",
    (scheme) => {
      expect(prefillOutcomes(scheme, ranked)).toEqual([
        tag("a", "winner", 1),
        tag("b", "runner_up", 2),
        tag("c", "runner_up", 3),
        tag("d", "runner_up", 3),
        tag("e", "none"),
      ]);
    }
  );

  it("shares first place when the ranking does", () => {
    expect(
      prefillOutcomes("ranked_123", [
        { entryId: "a", rank: 1 },
        { entryId: "b", rank: 1 },
        { entryId: "c", rank: 3 },
      ])
    ).toEqual([
      tag("a", "winner", 1),
      tag("b", "winner", 1),
      tag("c", "runner_up", 3),
    ]);
  });

  it("leaves grades to the manager", () => {
    expect(prefillOutcomes("grades_ab", ranked.slice(0, 2))).toEqual([
      tag("a", "none"),
      tag("b", "none"),
    ]);
  });
});

describe("outcomeTagProblems()", () => {
  const entries = ["a", "b", "c", "d"];

  it("accepts a complete, consistent set of tags", () => {
    expect(
      outcomeTagProblems("ranked_123", entries, [
        tag("a", "winner", 1, true),
        tag("b", "runner_up", 2),
        tag("c", "special_mention", null, true),
        tag("d", "finalist"),
      ])
    ).toEqual([]);
  });

  it("refuses entries outside the round and entries tagged twice", () => {
    expect(
      outcomeTagProblems("ranked_123", entries, [
        tag("a", "finalist"),
        tag("a", "none"),
        tag("z", "finalist"),
      ])
    ).toEqual([
      { code: "duplicate_entry", entryId: "a" },
      { code: "unknown_entry", entryId: "z" },
    ]);
  });

  it("ties award positions to the outcome and the scheme", () => {
    expect(
      outcomeTagProblems("ranked_123", entries, [
        tag("a", "winner", 2),
        tag("b", "runner_up", 1),
        tag("c", "finalist", 3),
        tag("d", "runner_up", 4),
      ])
    ).toEqual([
      { code: "award_position_invalid", entryId: "a" },
      { code: "award_position_invalid", entryId: "b" },
      { code: "award_position_invalid", entryId: "c" },
      { code: "award_position_invalid", entryId: "d" },
    ]);
    // Grades have A (1) and B (2) only.
    expect(
      outcomeTagProblems("grades_ab", entries, [
        tag("a", "winner", 1),
        tag("b", "runner_up", 2),
        tag("c", "runner_up", 3),
        tag("d", "winner", null),
      ])
    ).toEqual([
      { code: "award_position_invalid", entryId: "c" },
      { code: "award_position_invalid", entryId: "d" },
    ]);
  });
});
