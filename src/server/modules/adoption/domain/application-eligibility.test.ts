import { describe, expect, it } from "vitest";

import {
  type ApplicationEligibilityInput,
  decideNewApplication,
} from "./application-eligibility";

/** An adult applying to a published listing of a verified organisation. */
const OK: ApplicationEligibilityInput = {
  applicantAgeYears: 32,
  minAgeYears: 18,
  listing: { status: "published", organisationVerified: true },
  applicantRepresentsListing: false,
  hasOpenApplication: false,
  sharingConsent: true,
};

describe("decideNewApplication", () => {
  it("lets an adult apply to a published listing, telling the applicant and the owner", () => {
    expect(decideNewApplication(OK)).toEqual({
      ok: true,
      status: "submitted",
      notify: ["applicant", "listing_owner"],
    });
  });

  it("accepts someone who turned the minimum age today", () => {
    expect(
      decideNewApplication({ ...OK, applicantAgeYears: 18 })
    ).toMatchObject({ ok: true });
  });

  it("refuses an applicant under the minimum age", () => {
    expect(decideNewApplication({ ...OK, applicantAgeYears: 17 })).toEqual({
      ok: false,
      reason: "under_min_age",
    });
    expect(
      decideNewApplication({ ...OK, applicantAgeYears: 20, minAgeYears: 21 })
    ).toEqual({ ok: false, reason: "under_min_age" });
  });

  it("asks for a date of birth when none is known", () => {
    expect(decideNewApplication({ ...OK, applicantAgeYears: null })).toEqual({
      ok: false,
      reason: "date_of_birth_required",
    });
  });

  it("only takes applications for a published listing of a verified organisation", () => {
    for (const status of [
      "draft",
      "on_hold",
      "adopted",
      "withdrawn",
    ] as const) {
      expect(
        decideNewApplication({
          ...OK,
          listing: { status, organisationVerified: true },
        })
      ).toEqual({ ok: false, reason: "listing_not_open" });
    }
    expect(
      decideNewApplication({
        ...OK,
        listing: { status: "published", organisationVerified: false },
      })
    ).toEqual({ ok: false, reason: "listing_not_open" });
  });

  it("refuses the listing organisation's own representatives", () => {
    expect(
      decideNewApplication({ ...OK, applicantRepresentsListing: true })
    ).toEqual({ ok: false, reason: "own_listing" });
  });

  it("refuses a second open application to the same listing", () => {
    expect(decideNewApplication({ ...OK, hasOpenApplication: true })).toEqual({
      ok: false,
      reason: "already_applied",
    });
  });

  it("needs the applicant's agreement to share their contact at the contact step", () => {
    expect(decideNewApplication({ ...OK, sharingConsent: false })).toEqual({
      ok: false,
      reason: "sharing_consent_required",
    });
  });

  it("reports the listing first, then ownership, age, a duplicate and consent", () => {
    const everythingWrong: ApplicationEligibilityInput = {
      applicantAgeYears: 15,
      minAgeYears: 18,
      listing: { status: "adopted", organisationVerified: false },
      applicantRepresentsListing: true,
      hasOpenApplication: true,
      sharingConsent: false,
    };
    const reasons: string[] = [];
    let input = everythingWrong;
    const fixes: Partial<ApplicationEligibilityInput>[] = [
      { listing: OK.listing },
      { applicantRepresentsListing: false },
      { applicantAgeYears: 40 },
      { hasOpenApplication: false },
      { sharingConsent: true },
    ];
    for (const fix of fixes) {
      const decision = decideNewApplication(input);
      reasons.push(decision.ok ? "ok" : decision.reason);
      input = { ...input, ...fix };
    }
    reasons.push(decideNewApplication(input).ok ? "ok" : "refused");
    expect(reasons).toEqual([
      "listing_not_open",
      "own_listing",
      "under_min_age",
      "already_applied",
      "sharing_consent_required",
      "ok",
    ]);
  });
});
