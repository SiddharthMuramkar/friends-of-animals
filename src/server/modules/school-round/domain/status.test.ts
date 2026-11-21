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
  // The shortlist deadline passed before the school finalised.
  ["open", "overdue"],
  // The school finalises late, or a competition manager closes the round
  // on its behalf.
  ["overdue", "finalised"],
  ["overdue", "closed_on_behalf"],
  // A competition manager reopens a decided round: open before the
  // shortlist deadline, overdue after it.
  ["finalised", "open"],
  ["finalised", "overdue"],
  ["closed_on_behalf", "open"],
  ["closed_on_behalf", "overdue"],
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
      assertSchoolRoundTransition("open", "closed_on_behalf");
      expect.unreachable("open -> closed_on_behalf is forbidden");
    } catch (error) {
      expect(error).toBeInstanceOf(SchoolRoundTransitionError);
      const refused = error as SchoolRoundTransitionError;
      expect(refused.from).toBe("open");
      expect(refused.to).toBe("closed_on_behalf");
      expect(refused.message).toContain("open -> closed_on_behalf");
    }
  });
});

describe("isSchoolRoundEditable()", () => {
  it.each(["open", "overdue"] as const)(
    "lets the coordinator change an %s round",
    (status) => {
      expect(isSchoolRoundEditable(status)).toBe(true);
    }
  );

  it.each(["finalised", "closed_on_behalf"] as const)(
    "keeps a %s round as it is",
    (status) => {
      expect(isSchoolRoundEditable(status)).toBe(false);
    }
  );
});
