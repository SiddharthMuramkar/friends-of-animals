import { describe, expect, it } from "vitest";

import {
  assertSchoolRoundTransition,
  canTransitionSchoolRound,
  isSchoolRoundEditable,
  SCHOOL_ROUND_STATUSES,
  SchoolRoundTransitionError,
  type SchoolRoundStatus,
} from "./status";

// The expected machine, written out by hand. A ticket that adds a
// transition adds its row here and in the module's table.
const ALLOWED: readonly (readonly [
  SchoolRoundStatus | null,
  SchoolRoundStatus,
])[] = [
  // Opened when the competition enters school judging.
  [null, "open"],
  // The coordinator attests the judging and finalises the shortlist.
  ["open", "finalised"],
];

const FROM: readonly (SchoolRoundStatus | null)[] = [
  null,
  "open",
  "overdue",
  "finalised",
  "closed_on_behalf",
];
const TO: readonly SchoolRoundStatus[] = [
  "open",
  "overdue",
  "finalised",
  "closed_on_behalf",
];

const isAllowed = (from: SchoolRoundStatus | null, to: SchoolRoundStatus) =>
  ALLOWED.some(([f, t]) => f === from && t === to);

const PAIRS = FROM.flatMap((from) =>
  TO.map((to) => ({ from, to, allowed: isAllowed(from, to) }))
);

describe("school round status machine", () => {
  it("declares every status the school round will ever need", () => {
    expect([...SCHOOL_ROUND_STATUSES]).toEqual([
      "open",
      "overdue",
      "finalised",
      "closed_on_behalf",
    ]);
  });

  it.each(PAIRS.filter((pair) => pair.allowed))(
    "allows $from -> $to",
    ({ from, to }) => {
      expect(canTransitionSchoolRound(from, to)).toBe(true);
      expect(() => assertSchoolRoundTransition(from, to)).not.toThrow();
    }
  );

  it.each(PAIRS.filter((pair) => !pair.allowed))(
    "forbids $from -> $to",
    ({ from, to }) => {
      expect(canTransitionSchoolRound(from, to)).toBe(false);
      expect(() => assertSchoolRoundTransition(from, to)).toThrow(
        SchoolRoundTransitionError
      );
    }
  );

  it("names both ends of a forbidden transition", () => {
    try {
      assertSchoolRoundTransition("finalised", "open");
      expect.unreachable("finalised -> open is forbidden");
    } catch (error) {
      expect(error).toBeInstanceOf(SchoolRoundTransitionError);
      const refused = error as SchoolRoundTransitionError;
      expect(refused.from).toBe("finalised");
      expect(refused.to).toBe("open");
      expect(refused.message).toContain("finalised -> open");
    }
  });
});

describe("isSchoolRoundEditable()", () => {
  it("lets the coordinator change an open round", () => {
    expect(isSchoolRoundEditable("open")).toBe(true);
  });

  it.each(["overdue", "finalised", "closed_on_behalf"] as const)(
    "keeps a %s round as it is",
    (status) => {
      expect(isSchoolRoundEditable(status)).toBe(false);
    }
  );
});
