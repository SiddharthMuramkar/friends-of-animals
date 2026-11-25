import { describe, expect, it } from "vitest";

import {
  assertSchoolRoundTransition,
  canTransitionSchoolRound,
  isSchoolRoundEditable,
  isSchoolRoundFinished,
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
  // The shortlist deadline passes with the round unfinished (#90).
  ["open", "overdue"],
  // The school can still finalise late.
  ["overdue", "finalised"],
  // A competition manager closes it on the school's behalf.
  ["overdue", "closed_on_behalf"],
  // A competition manager reopens a decided round: open before the
  // deadline, overdue after it.
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
      assertSchoolRoundTransition("finalised", "closed_on_behalf");
      expect.unreachable("finalised -> closed_on_behalf is forbidden");
    } catch (error) {
      expect(error).toBeInstanceOf(SchoolRoundTransitionError);
      const refused = error as SchoolRoundTransitionError;
      expect(refused.from).toBe("finalised");
      expect(refused.to).toBe("closed_on_behalf");
      expect(refused.message).toContain("finalised -> closed_on_behalf");
    }
  });
});

describe("isSchoolRoundEditable()", () => {
  it("lets the coordinator change an open round", () => {
    expect(isSchoolRoundEditable("open")).toBe(true);
  });

  it("lets the school still change and finalise an overdue round", () => {
    expect(isSchoolRoundEditable("overdue")).toBe(true);
  });

  it.each(["finalised", "closed_on_behalf"] as const)(
    "keeps a %s round as it is",
    (status) => {
      expect(isSchoolRoundEditable(status)).toBe(false);
    }
  );
});

describe("isSchoolRoundFinished()", () => {
  it.each([
    ["open", false],
    ["overdue", false],
    ["finalised", true],
    ["closed_on_behalf", true],
  ] as const)("%s is finished: %s", (status, finished) => {
    expect(isSchoolRoundFinished(status)).toBe(finished);
  });
});
