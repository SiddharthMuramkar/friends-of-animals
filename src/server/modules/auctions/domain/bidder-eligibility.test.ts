import { describe, expect, it } from "vitest";

import {
  BIDDER_MIN_AGE,
  decideBidderEligibility,
  decideBidderProfile,
} from "./bidder-eligibility";

const TERMS = "2027-01";

describe("BIDDER_MIN_AGE", () => {
  it("is 18: only adults bid", () => {
    expect(BIDDER_MIN_AGE).toBe(18);
  });
});

describe("decideBidderProfile", () => {
  const adult = {
    declaredAgeYears: 30,
    knownAgesYears: [],
    hasActiveGuardianLink: false,
    acceptedTermsVersion: TERMS,
    currentTermsVersion: TERMS,
  };

  it("saves an adult who accepts the current terms", () => {
    expect(decideBidderProfile(adult)).toEqual({ ok: true });
  });

  it("saves someone who turns 18 today", () => {
    expect(decideBidderProfile({ ...adult, declaredAgeYears: 18 })).toEqual({
      ok: true,
    });
  });

  it("refuses a declared age of 17", () => {
    expect(decideBidderProfile({ ...adult, declaredAgeYears: 17 })).toEqual({
      ok: false,
      reason: "minor",
    });
  });

  it("refuses a teen with a guardian link whatever date of birth they type", () => {
    expect(
      decideBidderProfile({ ...adult, hasActiveGuardianLink: true })
    ).toEqual({ ok: false, reason: "minor" });
    expect(
      decideBidderProfile({
        ...adult,
        declaredAgeYears: null,
        hasActiveGuardianLink: true,
      })
    ).toEqual({ ok: false, reason: "minor" });
  });

  it("refuses an adult declaration when a profile we hold says the user is under 18", () => {
    expect(decideBidderProfile({ ...adult, knownAgesYears: [16] })).toEqual({
      ok: false,
      reason: "minor",
    });
  });

  it("refuses an unreadable date of birth", () => {
    expect(decideBidderProfile({ ...adult, declaredAgeYears: null })).toEqual({
      ok: false,
      reason: "dob_invalid",
    });
  });

  it("refuses a profile that doesn't accept the current terms of sale", () => {
    expect(
      decideBidderProfile({ ...adult, acceptedTermsVersion: null })
    ).toEqual({ ok: false, reason: "terms_not_accepted" });
    expect(
      decideBidderProfile({ ...adult, acceptedTermsVersion: "2026-12" })
    ).toEqual({ ok: false, reason: "terms_not_accepted" });
  });

  it("says minor before anything else is wrong", () => {
    expect(
      decideBidderProfile({
        declaredAgeYears: 15,
        knownAgesYears: [],
        hasActiveGuardianLink: false,
        acceptedTermsVersion: null,
        currentTermsVersion: TERMS,
      })
    ).toEqual({ ok: false, reason: "minor" });
  });
});

describe("decideBidderEligibility", () => {
  const ready = {
    profile: { ageYears: 30, acceptedTermsVersion: TERMS },
    knownAgesYears: [],
    hasActiveGuardianLink: false,
    currentTermsVersion: TERMS,
  };

  it("lets an adult with a bidder profile on the current terms bid", () => {
    expect(decideBidderEligibility(ready)).toEqual({ ok: true });
  });

  it("asks an adult without a bidder profile to make one", () => {
    expect(decideBidderEligibility({ ...ready, profile: null })).toEqual({
      ok: false,
      reason: "bidder_profile_required",
    });
  });

  it("asks for the terms again after they change", () => {
    expect(
      decideBidderEligibility({ ...ready, currentTermsVersion: "2027-06" })
    ).toEqual({ ok: false, reason: "terms_not_accepted" });
  });

  it("refuses a signed-in teen with a guardian link even with no bidder profile", () => {
    expect(
      decideBidderEligibility({
        ...ready,
        profile: null,
        hasActiveGuardianLink: true,
      })
    ).toEqual({ ok: false, reason: "minor" });
  });

  it("refuses a user any of whose known dates of birth makes them under 18", () => {
    expect(
      decideBidderEligibility({ ...ready, knownAgesYears: [40, 17] })
    ).toEqual({ ok: false, reason: "minor" });
  });

  it("refuses a stored profile whose holder is now under 18 by its own date of birth", () => {
    expect(
      decideBidderEligibility({
        ...ready,
        profile: { ageYears: 17, acceptedTermsVersion: TERMS },
      })
    ).toEqual({ ok: false, reason: "minor" });
  });
});
