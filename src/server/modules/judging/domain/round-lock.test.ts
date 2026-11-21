import { describe, expect, it } from "vitest";

import {
  decideRoundLock,
  OVERRIDE_REASON_LIMITS,
  ROUND_ACTIONS,
  ROUND_STATUSES,
  roundAllows,
  type RoundAction,
  type RoundStatus,
} from "./round-lock";

// Which actions each round status allows. Every other pair is refused.
const ALLOWED: ReadonlyArray<[RoundStatus, RoundAction]> = [
  ["open", "score"],
  ["open", "viewRankings"],
  ["open", "lock"],
  ["open", "overrideLock"],
  ["locked", "viewRankings"],
  ["locked", "tagOutcomes"],
];

const EVERY_PAIR = ROUND_STATUSES.flatMap((status) =>
  ROUND_ACTIONS.map((action) => [status, action] as const)
);

const FORBIDDEN = EVERY_PAIR.filter(
  ([status, action]) => !ALLOWED.some(([s, a]) => s === status && a === action)
);

describe("roundAllows()", () => {
  it("knows the round statuses and the actions this ticket adds", () => {
    expect(ROUND_STATUSES).toEqual(["draft", "open", "locked", "cancelled"]);
    expect(ROUND_ACTIONS).toEqual([
      "score",
      "viewRankings",
      "lock",
      "overrideLock",
      "tagOutcomes",
    ]);
  });

  it.each(ALLOWED)("a %s round allows %s", (status, action) => {
    expect(roundAllows(status, action)).toBe(true);
  });

  it.each(FORBIDDEN)("a %s round refuses %s", (status, action) => {
    expect(roundAllows(status, action)).toBe(false);
  });

  it("covers every pair exactly once", () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(20);
    expect(FORBIDDEN).toContainEqual(["locked", "score"]);
    expect(FORBIDDEN).toContainEqual(["open", "tagOutcomes"]);
  });
});

const scored = (id: string) => ({ assignmentId: id, scored: true });
const unscored = (id: string) => ({ assignmentId: id, scored: false });
const REASON = "Judge 3 fell ill; two complete sheets per entry suffice.";

describe("decideRoundLock(): the round transitions this ticket owns", () => {
  it("open -> locked once every assignment is scored", () => {
    expect(
      decideRoundLock({
        status: "open",
        assignments: [scored("a1"), scored("a2")],
      })
    ).toEqual({ ok: true, to: "locked", mode: "complete" });
  });

  it("refuses while any assignment is unscored, giving only a count", () => {
    expect(
      decideRoundLock({
        status: "open",
        assignments: [scored("a1"), unscored("a2"), unscored("a3")],
      })
    ).toEqual({ ok: false, code: "unscored_assignments", unscoredCount: 2 });
  });

  it("open -> locked by override with a reason, naming what was unscored", () => {
    expect(
      decideRoundLock({
        status: "open",
        assignments: [unscored("a3"), scored("a1"), unscored("a2")],
        override: { reason: `  ${REASON}  ` },
      })
    ).toEqual({
      ok: true,
      to: "locked",
      mode: "override",
      reason: REASON,
      unscoredAssignmentIds: ["a2", "a3"],
    });
  });

  it("refuses an override whose reason is blank, too short or too long", () => {
    const assignments = [unscored("a1")];
    for (const reason of [
      "",
      "   ",
      "x".repeat(OVERRIDE_REASON_LIMITS.min - 1),
      "x".repeat(OVERRIDE_REASON_LIMITS.max + 1),
    ]) {
      expect(
        decideRoundLock({ status: "open", assignments, override: { reason } })
      ).toEqual({ ok: false, code: "override_reason_invalid" });
    }
  });

  it("locks as complete, recording no override, when nothing is unscored", () => {
    expect(
      decideRoundLock({
        status: "open",
        assignments: [scored("a1")],
        override: { reason: REASON },
      })
    ).toEqual({ ok: true, to: "locked", mode: "complete" });
  });

  it("refuses an empty round unless overridden", () => {
    expect(decideRoundLock({ status: "open", assignments: [] })).toEqual({
      ok: false,
      code: "no_assignments",
    });
    expect(
      decideRoundLock({
        status: "open",
        assignments: [],
        override: { reason: REASON },
      })
    ).toEqual({
      ok: true,
      to: "locked",
      mode: "override",
      reason: REASON,
      unscoredAssignmentIds: [],
    });
  });

  it.each(["draft", "locked", "cancelled"] as const)(
    "refuses %s -> locked, with or without an override",
    (status) => {
      for (const override of [undefined, { reason: REASON }]) {
        expect(
          decideRoundLock({
            status,
            assignments: [scored("a1")],
            ...(override ? { override } : {}),
          })
        ).toEqual({ ok: false, code: "round_not_open", status });
      }
    }
  );
});
