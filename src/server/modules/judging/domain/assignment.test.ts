import { describe, expect, it } from "vitest";

import { decideAssignment, type AssignmentFacts } from "./assignment";

const CLEAR: AssignmentFacts = {
  roundAcceptsJudges: true,
  judgeReady: true,
  inPool: true,
  conflicted: false,
  alreadyAssigned: false,
};

describe("assigning one entry to one judge", () => {
  it("assigns when nothing stands in the way", () => {
    expect(decideAssignment(CLEAR)).toEqual({ ok: true });
  });

  it.each([
    [
      "the round is locked or cancelled",
      { roundAcceptsJudges: false },
      "round_closed",
    ],
    ["the judge isn't onboarded", { judgeReady: false }, "judge_not_ready"],
    ["the entry isn't in the round's pool", { inPool: false }, "not_in_pool"],
    [
      "the judge has a conflict with the entry",
      { conflicted: true },
      "conflict",
    ],
    [
      "the pair is already assigned",
      { alreadyAssigned: true },
      "already_assigned",
    ],
  ] as const)("refuses when %s", (_, gap, reason) => {
    expect(decideAssignment({ ...CLEAR, ...gap })).toEqual({
      ok: false,
      reason,
    });
  });

  it("gives the reason that is about the round before the judge", () => {
    expect(
      decideAssignment({
        ...CLEAR,
        roundAcceptsJudges: false,
        judgeReady: false,
      })
    ).toEqual({ ok: false, reason: "round_closed" });
  });

  it("gives the reason that is about the judge before the entry", () => {
    expect(
      decideAssignment({ ...CLEAR, judgeReady: false, conflicted: true })
    ).toEqual({ ok: false, reason: "judge_not_ready" });
  });

  it("never reports a conflicted pair as merely already assigned", () => {
    expect(
      decideAssignment({ ...CLEAR, conflicted: true, alreadyAssigned: true })
    ).toEqual({ ok: false, reason: "conflict" });
  });

  it("checks the pool before conflicts, so outsiders learn nothing", () => {
    expect(
      decideAssignment({ ...CLEAR, inPool: false, conflicted: true })
    ).toEqual({ ok: false, reason: "not_in_pool" });
  });
});
