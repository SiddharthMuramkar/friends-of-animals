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
};

const PAIRS = REGISTRATION_STATUSES.flatMap((from) =>
  REGISTRATION_STATUSES.map((to) => [from, to] as const)
);

describe("the registration status machine", () => {
  it("knows the statuses this ticket introduces", () => {
    expect(REGISTRATION_STATUSES).toEqual(["enrolled", "withdrawn"]);
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
    expect(canTransition(from, to, "coordinator")).toBe(
      ALLOWED[`${from}->${to}`] === "coordinator"
    );
  });

  it("never brings a withdrawn student back", () => {
    expect(canTransition("withdrawn", "enrolled", "coordinator")).toBe(false);
  });
});
