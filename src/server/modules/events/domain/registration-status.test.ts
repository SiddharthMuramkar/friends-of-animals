import { describe, expect, it } from "vitest";

import {
  ACTIVE_REGISTRATION_STATUSES,
  canMoveRegistration,
  moveRegistration,
  PLACE_HOLDING_STATUSES,
  REGISTRATION_STATUSES,
  RegistrationTransitionError,
  type RegistrationStatus,
} from "./registration-status";

// Every allowed move, written out by hand so a change to the table in
// registration-status.ts has to change this list too. Every other pair is
// forbidden.
const ALLOWED: ReadonlyArray<[RegistrationStatus | null, RegistrationStatus]> =
  [
    [null, "registered"],
    [null, "waitlisted"],
    ["waitlisted", "registered"],
    ["registered", "cancelled"],
    ["waitlisted", "cancelled"],
    ["registered", "checked_in"],
    ["registered", "no_show"],
  ];

const key = (from: string | null, to: string) => `${from ?? "(new)"} -> ${to}`;
const allowed = new Set(ALLOWED.map(([from, to]) => key(from, to)));
const pairs = [null, ...REGISTRATION_STATUSES].flatMap((from) =>
  REGISTRATION_STATUSES.map((to) => [from, to] as const)
);

describe("event registration statuses", () => {
  it("has every status from the start, check-in's included", () => {
    expect(REGISTRATION_STATUSES).toEqual([
      "registered",
      "waitlisted",
      "cancelled",
      "checked_in",
      "no_show",
    ]);
  });

  it.each(pairs.filter(([from, to]) => allowed.has(key(from, to))))(
    "allows %s -> %s",
    (from, to) => {
      expect(canMoveRegistration(from, to)).toBe(true);
      expect(moveRegistration(from, to)).toBe(to);
    }
  );

  it.each(pairs.filter(([from, to]) => !allowed.has(key(from, to))))(
    "forbids %s -> %s",
    (from, to) => {
      expect(canMoveRegistration(from, to)).toBe(false);
      expect(() => moveRegistration(from, to)).toThrow(
        RegistrationTransitionError
      );
    }
  );

  it("names both ends of a forbidden move", () => {
    expect(() => moveRegistration("waitlisted", "checked_in")).toThrow(
      "A registration can't move from waitlisted to checked_in"
    );
  });

  it("keeps cancelled, checked in and no-show final", () => {
    for (const to of REGISTRATION_STATUSES) {
      expect(canMoveRegistration("cancelled", to)).toBe(false);
      expect(canMoveRegistration("checked_in", to)).toBe(false);
      expect(canMoveRegistration("no_show", to)).toBe(false);
    }
  });

  it("counts everything but a cancellation as someone's one registration", () => {
    expect(ACTIVE_REGISTRATION_STATUSES).toEqual([
      "registered",
      "waitlisted",
      "checked_in",
      "no_show",
    ]);
  });

  it("holds a place only while registered or checked in", () => {
    expect(PLACE_HOLDING_STATUSES).toEqual(["registered", "checked_in"]);
  });
});
