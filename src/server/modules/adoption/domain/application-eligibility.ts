// Who may apply to adopt an animal, and why not (#130). An application
// starts `submitted`, or is refused with nothing written, in this order:
//
//   listing_not_open        the animal isn't published under a verified
//                           directory listing (a draft, on hold, adopted,
//                           withdrawn, or the organisation suspended)
//   own_listing             the applicant represents the listing organisation
//   date_of_birth_required  no date of birth is known or typed
//   under_min_age           younger than `adoption.minAdopterAgeYears` (18)
//   already_applied         an open application to the same animal exists
//
// Pure: the use case works out the age with the participants module's
// `ageAt` (completed years on India's calendar at the clock's instant).

import type { AdoptionListingStatus } from "./status";

/** FOA's default until leadership confirms it (HR-62). */
export const MIN_ADOPTER_AGE_DEFAULT = 18;

/** Adults only: nobody under 18 adopts, whatever the setting says. */
export const MIN_ADOPTER_AGE_BOUNDS = { min: 18, max: 25 } as const;

export type NewAdoptionApplicationFacts = {
  listing: { status: AdoptionListingStatus; directoryVerified: boolean };
  applicantRepresentsListing: boolean;
  /** null: no date of birth is known or was typed. */
  applicantAgeYears: number | null;
  minAgeYears: number;
  hasOpenApplication: boolean;
};

export type NewAdoptionApplicationRefusal =
  | "listing_not_open"
  | "own_listing"
  | "date_of_birth_required"
  | "under_min_age"
  | "already_applied";

export type NewAdoptionApplicationDecision =
  | { ok: true; status: "submitted" }
  | { ok: false; reason: NewAdoptionApplicationRefusal };

export function decideNewAdoptionApplication(
  facts: NewAdoptionApplicationFacts
): NewAdoptionApplicationDecision {
  if (
    facts.listing.status !== "published" ||
    !facts.listing.directoryVerified
  ) {
    return { ok: false, reason: "listing_not_open" };
  }
  if (facts.applicantRepresentsListing) {
    return { ok: false, reason: "own_listing" };
  }
  if (facts.applicantAgeYears === null) {
    return { ok: false, reason: "date_of_birth_required" };
  }
  // A bad stored setting only makes the rule stricter, never looser.
  const minimum = Math.max(facts.minAgeYears, MIN_ADOPTER_AGE_BOUNDS.min);
  if (facts.applicantAgeYears < minimum) {
    return { ok: false, reason: "under_min_age" };
  }
  if (facts.hasOpenApplication) return { ok: false, reason: "already_applied" };
  return { ok: true, status: "submitted" };
}
