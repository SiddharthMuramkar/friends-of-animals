import { describe, expect, it } from "vitest";

import {
  COMPETITION_STATUSES,
  canTransition,
  transitionCause,
  type CompetitionStatus,
  type TransitionCause,
} from "./status-machine";

// Every ordered pair of statuses, with who may make the move. A pair that
// is not listed here is forbidden for everyone.
const ALLOWED: Record<string, TransitionCause> = {
  "draft->published": "manager",
  "published->registration_open": "schedule",
  "registration_open->registration_closed": "schedule",
};

const PAIRS = COMPETITION_STATUSES.flatMap((from) =>
  COMPETITION_STATUSES.map((to) => [from, to] as const)
);

describe("the competition status machine", () => {
  it("knows the statuses in their order", () => {
    expect(COMPETITION_STATUSES).toEqual([
      "draft",
      "published",
      "registration_open",
      "registration_closed",
    ]);
  });

  it.each(PAIRS)("%s -> %s has the cause the table gives", (from, to) => {
    expect(transitionCause(from, to)).toBe(ALLOWED[`${from}->${to}`] ?? null);
  });

  it.each(PAIRS)("%s -> %s is allowed only for its own cause", (from, to) => {
    const cause = ALLOWED[`${from}->${to}`];
    for (const by of ["manager", "schedule"] as const) {
      expect(canTransition(from, to, by)).toBe(by === cause);
    }
  });

  it("never lets a manager open or close registration by hand", () => {
    expect(canTransition("published", "registration_open", "manager")).toBe(
      false
    );
    expect(
      canTransition("registration_open", "registration_closed", "manager")
    ).toBe(false);
  });

  it("never skips a status, even on the schedule", () => {
    expect(canTransition("published", "registration_closed", "schedule")).toBe(
      false
    );
    expect(canTransition("draft", "registration_open", "schedule")).toBe(false);
  });

  it("never moves backwards or stays put", () => {
    const order = (s: CompetitionStatus) => COMPETITION_STATUSES.indexOf(s);
    for (const [from, to] of PAIRS) {
      if (order(to) <= order(from))
        expect(transitionCause(from, to)).toBe(null);
    }
  });
});
