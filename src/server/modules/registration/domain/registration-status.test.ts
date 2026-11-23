import { describe, expect, it } from "vitest";

import {
  canStartIn,
  canTransition,
  initialRegistrationStatus,
  REGISTRATION_STATUSES,
  transitionCauses,
  type RegistrationCause,
} from "./registration-status";

// Every ordered pair of statuses, with who may make the move. A pair that
// is not listed here is forbidden for everyone.
const ALLOWED: Record<string, readonly RegistrationCause[]> = {
  "enrolled->withdrawn": ["coordinator"],
  // Paid in full, or free (#77).
  "enrolled->confirmed": ["payment"],
  // An adult's own registration, once its fee is paid or found free (#78).
  "pending_payment->confirmed": ["payment"],
  // A paid registration whose fee went back (#80): only the refund moves it.
  "confirmed->refunded": ["payment"],
  // Guardian consent releases the hold. The participant can also continue as an adult.
  "pending_guardian->pending_payment": ["guardian", "participant"],
  "pending_guardian->withdrawn": ["guardian"],
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
      "refunded",
      "pending_guardian",
    ]);
  });

  it("never brings a refunded registration back (#80)", () => {
    for (const to of REGISTRATION_STATUSES) {
      for (const cause of CAUSES) {
        expect(canTransition("refunded", to, cause)).toBe(false);
      }
    }
  });

  it("starts an adult who registers themselves as waiting for payment", () => {
    expect(initialRegistrationStatus("individual")).toEqual({
      status: "pending_payment",
      cause: "participant",
    });
  });

  it.each(REGISTRATION_STATUSES)(
    "starts an individual registration only waiting for its fee or a guardian: %s",
    (status) => {
      expect(canStartIn("individual", status)).toBe(
        status === "pending_payment" || status === "pending_guardian"
      );
    }
  );

  it.each(REGISTRATION_STATUSES)(
    "starts a student only as enrolled: %s",
    (status) => {
      expect(canStartIn("institution", status)).toBe(status === "enrolled");
    }
  );

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

  it.each(PAIRS)("%s -> %s has exactly the allowed causes", (from, to) => {
    expect(transitionCauses(from, to)).toEqual(ALLOWED[`${from}->${to}`] ?? []);
  });

  it.each(PAIRS)("%s -> %s is allowed only for its own causes", (from, to) => {
    for (const cause of CAUSES) {
      expect(canTransition(from, to, cause)).toBe(
        ALLOWED[`${from}->${to}`]?.includes(cause) ?? false
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
