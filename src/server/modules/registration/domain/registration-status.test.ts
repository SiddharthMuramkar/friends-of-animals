import { describe, expect, it } from "vitest";

import {
  canTransition,
  initialRegistrationStatus,
  REGISTRATION_STATUSES,
  transitionCause,
  type RegistrationCause,
} from "./registration-status";

// Every ordered pair of statuses, with who may make the move. A pair that
// is not listed here is forbidden for everyone.
const ALLOWED: Record<string, RegistrationCause> = {
  "enrolled->withdrawn": "coordinator",
  // Paid in full, or free (#77).
  "enrolled->confirmed": "payment",
};

const CAUSES: readonly RegistrationCause[] = ["coordinator", "payment"];

const PAIRS = REGISTRATION_STATUSES.flatMap((from) =>
  REGISTRATION_STATUSES.map((to) => [from, to] as const)
);

describe("the registration status machine", () => {
  it("knows the statuses this ticket introduces", () => {
    expect(REGISTRATION_STATUSES).toEqual([
      "enrolled",
      "confirmed",
      "withdrawn",
    ]);
  });

  it("starts a student enrolled by a coordinator as enrolled", () => {
    expect(initialRegistrationStatus("institution")).toEqual({
      status: "enrolled",
      cause: "coordinator",
    });
  });

  it.each(PAIRS)("%s -> %s has the cause the table gives", (from, to) => {
    expect(transitionCause(from, to)).toBe(ALLOWED[`${from}->${to}`] ?? null);
  });

  it.each(PAIRS)("%s -> %s is allowed only for its own cause", (from, to) => {
    for (const cause of CAUSES) {
      expect(canTransition(from, to, cause)).toBe(
        ALLOWED[`${from}->${to}`] === cause
      );
    }
  });

  it("never brings a withdrawn student back", () => {
    expect(canTransition("withdrawn", "enrolled", "coordinator")).toBe(false);
  });

  it("confirms a registration once, and never a withdrawn one", () => {
    expect(canTransition("confirmed", "confirmed", "payment")).toBe(false);
    expect(canTransition("withdrawn", "confirmed", "payment")).toBe(false);
  });

  it("leaves a coordinator unable to confirm, or to withdraw a paid student", () => {
    expect(canTransition("enrolled", "confirmed", "coordinator")).toBe(false);
    expect(canTransition("confirmed", "withdrawn", "coordinator")).toBe(false);
  });
});
