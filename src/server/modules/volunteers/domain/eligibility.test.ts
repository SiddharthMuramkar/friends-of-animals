import { describe, expect, it } from "vitest";

import {
  decideVolunteerApplication,
  VOLUNTEER_AGE_RULE_BOUNDS,
  VOLUNTEER_AGE_RULE_DEFAULTS,
  type VolunteerApplicant,
} from "./eligibility";

const adult: VolunteerApplicant = {
  ageYears: 30,
  guardian: "none",
  isVolunteer: false,
  hasOpenApplication: false,
};

function decide(applicant: Partial<VolunteerApplicant>) {
  return decideVolunteerApplication({
    applicant: { ...adult, ...applicant },
    rules: VOLUNTEER_AGE_RULE_DEFAULTS,
  });
}

describe("decideVolunteerApplication", () => {
  it("sends an adult's application straight to a community manager", () => {
    expect(decide({ ageYears: 18 })).toEqual({ ok: true, status: "submitted" });
    expect(decide({ ageYears: 64 })).toEqual({ ok: true, status: "submitted" });
  });

  it("refuses anyone under 14, guardian or not", () => {
    for (const guardian of ["verified", "unverified", "none"] as const) {
      expect(decide({ ageYears: 13, guardian })).toEqual({
        ok: false,
        reason: "under_min_age",
      });
    }
    expect(decide({ ageYears: 0 })).toEqual({
      ok: false,
      reason: "under_min_age",
    });
  });

  it("holds a 14- to 17-year-old's application for their verified guardian", () => {
    for (const ageYears of [14, 15, 17]) {
      expect(decide({ ageYears, guardian: "verified" })).toEqual({
        ok: true,
        status: "awaiting_guardian",
      });
    }
  });

  it("refuses a 14- to 17-year-old with no verified guardian to ask", () => {
    expect(decide({ ageYears: 15, guardian: "none" })).toEqual({
      ok: false,
      reason: "guardian_required",
    });
    expect(decide({ ageYears: 17, guardian: "unverified" })).toEqual({
      ok: false,
      reason: "guardian_required",
    });
  });

  it("ignores the guardian for an adult", () => {
    expect(decide({ ageYears: 18, guardian: "verified" })).toEqual({
      ok: true,
      status: "submitted",
    });
  });

  it("refuses a second open application and a second volunteer role", () => {
    expect(decide({ hasOpenApplication: true })).toEqual({
      ok: false,
      reason: "application_open",
    });
    expect(decide({ isVolunteer: true })).toEqual({
      ok: false,
      reason: "already_volunteer",
    });
  });

  it("refuses in a fixed order: volunteer, open application, age, guardian", () => {
    expect(
      decide({ isVolunteer: true, hasOpenApplication: true, ageYears: 13 })
    ).toEqual({ ok: false, reason: "already_volunteer" });
    expect(decide({ hasOpenApplication: true, ageYears: 13 })).toEqual({
      ok: false,
      reason: "application_open",
    });
    expect(decide({ ageYears: 13, guardian: "none" })).toEqual({
      ok: false,
      reason: "under_min_age",
    });
  });

  it("follows the age settings when FOA changes them", () => {
    const rules = { minAgeYears: 16, guardianApprovalBelowAgeYears: 21 };
    const applicant = { ...adult, guardian: "verified" as const };
    expect(
      decideVolunteerApplication({
        applicant: { ...applicant, ageYears: 15 },
        rules,
      })
    ).toEqual({ ok: false, reason: "under_min_age" });
    expect(
      decideVolunteerApplication({
        applicant: { ...applicant, ageYears: 19 },
        rules,
      })
    ).toEqual({ ok: true, status: "awaiting_guardian" });
    expect(
      decideVolunteerApplication({
        applicant: { ...applicant, ageYears: 21 },
        rules,
      })
    ).toEqual({ ok: true, status: "submitted" });
  });

  it("never lets a setting outside its bounds admit a younger child or skip a minor's guardian", () => {
    const loose = { minAgeYears: 5, guardianApprovalBelowAgeYears: 10 };
    expect(
      decideVolunteerApplication({
        applicant: { ...adult, ageYears: 12 },
        rules: loose,
      })
    ).toEqual({ ok: false, reason: "under_min_age" });
    expect(
      decideVolunteerApplication({
        applicant: { ...adult, ageYears: 16, guardian: "none" },
        rules: loose,
      })
    ).toEqual({ ok: false, reason: "guardian_required" });
  });
});

describe("age rule settings", () => {
  it("defaults to 14 and over, with a guardian's approval under 18", () => {
    expect(VOLUNTEER_AGE_RULE_DEFAULTS).toEqual({
      minAgeYears: 14,
      guardianApprovalBelowAgeYears: 18,
    });
  });

  it("keeps the defaults inside the bounds the settings screen enforces", () => {
    const { minAgeYears, guardianApprovalBelowAgeYears } =
      VOLUNTEER_AGE_RULE_BOUNDS;
    expect(minAgeYears.min).toBe(13);
    expect(guardianApprovalBelowAgeYears.min).toBe(18);
    expect(VOLUNTEER_AGE_RULE_DEFAULTS.minAgeYears).toBeGreaterThanOrEqual(
      minAgeYears.min
    );
    expect(VOLUNTEER_AGE_RULE_DEFAULTS.minAgeYears).toBeLessThanOrEqual(
      minAgeYears.max
    );
    expect(
      VOLUNTEER_AGE_RULE_DEFAULTS.guardianApprovalBelowAgeYears
    ).toBeGreaterThanOrEqual(guardianApprovalBelowAgeYears.min);
    expect(
      VOLUNTEER_AGE_RULE_DEFAULTS.guardianApprovalBelowAgeYears
    ).toBeLessThanOrEqual(guardianApprovalBelowAgeYears.max);
  });
});
