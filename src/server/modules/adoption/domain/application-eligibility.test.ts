import { describe, expect, it } from "vitest";

import {
  decideNewAdoptionApplication,
  type NewAdoptionApplicationFacts,
} from "./application-eligibility";

const OPEN: NewAdoptionApplicationFacts = {
  listing: { status: "published", directoryVerified: true },
  applicantRepresentsListing: false,
  applicantAgeYears: 30,
  minAgeYears: 18,
  hasOpenApplication: false,
};

describe("decideNewAdoptionApplication", () => {
  it("submits an adult's application to a published animal", () => {
    expect(decideNewAdoptionApplication(OPEN)).toEqual({
      ok: true,
      status: "submitted",
    });
  });

  it("refuses an animal that isn't open for applications", () => {
    for (const status of [
      "draft",
      "on_hold",
      "adopted",
      "withdrawn",
    ] as const) {
      expect(
        decideNewAdoptionApplication({
          ...OPEN,
          listing: { status, directoryVerified: true },
        })
      ).toEqual({ ok: false, reason: "listing_not_open" });
    }
    expect(
      decideNewAdoptionApplication({
        ...OPEN,
        listing: { status: "published", directoryVerified: false },
      })
    ).toEqual({ ok: false, reason: "listing_not_open" });
  });

  it("refuses the listing organisation's own representative", () => {
    expect(
      decideNewAdoptionApplication({
        ...OPEN,
        applicantRepresentsListing: true,
      })
    ).toEqual({ ok: false, reason: "own_listing" });
  });

  it("asks for a date of birth when none is known", () => {
    expect(
      decideNewAdoptionApplication({ ...OPEN, applicantAgeYears: null })
    ).toEqual({ ok: false, reason: "date_of_birth_required" });
  });

  it("refuses anyone younger than the minimum age, and never goes below 18", () => {
    expect(
      decideNewAdoptionApplication({ ...OPEN, applicantAgeYears: 17 })
    ).toEqual({ ok: false, reason: "under_min_age" });
    expect(
      decideNewAdoptionApplication({ ...OPEN, applicantAgeYears: 18 })
    ).toEqual({ ok: true, status: "submitted" });
    expect(
      decideNewAdoptionApplication({
        ...OPEN,
        applicantAgeYears: 20,
        minAgeYears: 21,
      })
    ).toEqual({ ok: false, reason: "under_min_age" });
    expect(
      decideNewAdoptionApplication({
        ...OPEN,
        applicantAgeYears: 16,
        minAgeYears: 10,
      })
    ).toEqual({ ok: false, reason: "under_min_age" });
  });

  it("refuses a second open application to the same animal", () => {
    expect(
      decideNewAdoptionApplication({ ...OPEN, hasOpenApplication: true })
    ).toEqual({ ok: false, reason: "already_applied" });
  });

  it("gives the first reason that applies", () => {
    expect(
      decideNewAdoptionApplication({
        listing: { status: "on_hold", directoryVerified: true },
        applicantRepresentsListing: true,
        applicantAgeYears: null,
        minAgeYears: 18,
        hasOpenApplication: true,
      })
    ).toEqual({ ok: false, reason: "listing_not_open" });
    expect(
      decideNewAdoptionApplication({
        ...OPEN,
        applicantAgeYears: 15,
        hasOpenApplication: true,
      })
    ).toEqual({ ok: false, reason: "under_min_age" });
  });
});
