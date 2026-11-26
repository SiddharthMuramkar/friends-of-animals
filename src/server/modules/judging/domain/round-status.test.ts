import { describe, expect, it } from "vitest";

import {
  JUDGING_ROUND_STATUSES,
  acceptsJudges,
  canMoveRound,
  isRoundEditable,
  type JudgingRoundStatus,
} from "./round-status";

// Every ordered pair the machine allows today. A pair missing here is
// forbidden. The lock guard has its own exhaustive tests in round-lock.test.ts.
const ALLOWED = new Set([
  "draft->open",
  "draft->cancelled",
  "open->cancelled",
  "open->locked",
]);

const PAIRS = JUDGING_ROUND_STATUSES.flatMap((from) =>
  JUDGING_ROUND_STATUSES.map((to) => [from, to] as const)
);

describe("the judging round status machine", () => {
  it("defines every status up front, in order", () => {
    expect(JUDGING_ROUND_STATUSES).toEqual([
      "draft",
      "open",
      "locked",
      "cancelled",
    ]);
  });

  it.each(PAIRS)("%s -> %s follows the table", (from, to) => {
    expect(canMoveRound(from, to)).toBe(ALLOWED.has(`${from}->${to}`));
  });

  it("never goes back to draft", () => {
    for (const from of JUDGING_ROUND_STATUSES) {
      expect(canMoveRound(from, "draft")).toBe(false);
    }
  });

  it("never leaves cancelled or locked", () => {
    const ends: JudgingRoundStatus[] = ["cancelled", "locked"];
    for (const from of ends) {
      for (const to of JUDGING_ROUND_STATUSES) {
        expect(canMoveRound(from, to)).toBe(false);
      }
    }
  });

  it("locks only an open round (subject to the guard)", () => {
    expect(canMoveRound("open", "locked")).toBe(true);
    expect(canMoveRound("draft", "locked")).toBe(false);
  });
});

describe("what a round allows in each status", () => {
  it.each([
    ["draft", true],
    ["open", false],
    ["locked", false],
    ["cancelled", false],
  ] as const)("settings of a %s round editable: %s", (status, editable) => {
    expect(isRoundEditable(status)).toBe(editable);
  });

  it.each([
    ["draft", true],
    ["open", true],
    ["locked", false],
    ["cancelled", false],
  ] as const)(
    "a %s round takes judges, entries and assignments: %s",
    (status, accepts) => {
      expect(acceptsJudges(status)).toBe(accepts);
    }
  );
});
