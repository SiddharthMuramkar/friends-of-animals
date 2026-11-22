import { describe, expect, it } from "vitest";

import { decideMinorRegistration } from "./minor-registration";

describe("decideMinorRegistration", () => {
  it("lets a linked teen with a verified guardian go straight to payment", () => {
    expect(
      decideMinorRegistration({
        ageYears: 15,
        registrant: { kind: "self", guardian: "verified" },
      })
    ).toEqual({ ok: true, status: "pending_payment", askGuardian: false });
  });

  it("holds a teen registering alone until a guardian is asked and verifies", () => {
    expect(
      decideMinorRegistration({
        ageYears: 15,
        registrant: { kind: "self", guardian: "none" },
      })
    ).toEqual({ ok: true, status: "pending_guardian", askGuardian: true });
  });

  it("waits for a linked guardian who has not verified, without asking anyone new", () => {
    expect(
      decideMinorRegistration({
        ageYears: 13,
        registrant: { kind: "self", guardian: "unverified" },
      })
    ).toEqual({ ok: true, status: "pending_guardian", askGuardian: false });
  });

  it("never lets a child under 13 register alone, whatever their guardian's state", () => {
    for (const guardian of ["verified", "unverified", "none"] as const) {
      expect(
        decideMinorRegistration({
          ageYears: 12,
          registrant: { kind: "self", guardian },
        })
      ).toEqual({ ok: false, reason: "under_13_needs_guardian" });
    }
  });

  it("lets a verified guardian register a child of any minor age for payment", () => {
    for (const ageYears of [6, 12, 13, 17]) {
      expect(
        decideMinorRegistration({
          ageYears,
          registrant: { kind: "guardian", verified: true },
        })
      ).toEqual({ ok: true, status: "pending_payment", askGuardian: false });
    }
  });

  it("holds a registration by a guardian who has not verified yet", () => {
    expect(
      decideMinorRegistration({
        ageYears: 9,
        registrant: { kind: "guardian", verified: false },
      })
    ).toEqual({ ok: true, status: "pending_guardian", askGuardian: false });
  });

  it("refuses a guardian registering someone who has turned 18", () => {
    expect(
      decideMinorRegistration({
        ageYears: 18,
        registrant: { kind: "guardian", verified: true },
      })
    ).toEqual({ ok: false, reason: "adult_registers_self" });
  });

  it("leaves an adult registering themselves on the adult path", () => {
    expect(
      decideMinorRegistration({
        ageYears: 18,
        registrant: { kind: "self", guardian: "none" },
      })
    ).toEqual({ ok: false, reason: "not_a_minor" });
  });
});
