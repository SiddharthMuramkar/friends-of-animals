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
  // An adult's own registration, once its fee is paid or found free (#78).
  "pending_payment->confirmed": "payment",
  // A minor's registration, once their guardian has verified and accepted
  // them (#81): then it waits for its fee like an adult's.
  "pending_guardian->pending_payment": "guardian",
};

const CAUSES: readonly RegistrationCause[] = [
  "coordinator",
  "participant",
  "payment",
  "guardian",
];

const PAIRS = REGISTRATION_STATUSES.flatMap((from) =>
  REGISTRATION_STATUSES.map((to) => [from, to] as const)
);

describe("the registration status machine", () => {
  it("knows the statuses this ticket introduces", () => {
    expect(REGISTRATION_STATUSES).toEqual([
      "enrolled",
      "confirmed",
      "withdrawn",
      "pending_payment",
      "pending_guardian",
    ]);
  });

  it("starts an adult who registers themselves as waiting for payment", () => {
    expect(initialRegistrationStatus("individual")).toEqual({
      status: "pending_payment",
      cause: "participant",
    });
  });

  it("lets no participant confirm their own registration", () => {
    expect(canTransition("pending_payment", "confirmed", "participant")).toBe(
      false
    );
  });

  it("never confirms a minor's registration before their guardian has verified", () => {
    for (const cause of CAUSES) {
      expect(canTransition("pending_guardian", "confirmed", cause)).toBe(false);
    }
  });

  it("never moves a registration back to waiting for a guardian", () => {
    for (const from of REGISTRATION_STATUSES) {
      for (const cause of CAUSES) {
        expect(canTransition(from, "pending_guardian", cause)).toBe(false);
      }
    }
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
