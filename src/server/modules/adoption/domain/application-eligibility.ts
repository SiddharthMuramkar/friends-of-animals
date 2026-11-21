// Who may apply to adopt an animal. Adopters must be adults: the minimum
// age is a setting (`adoption.minAdopterAgeYears`, 18 until FOA rules
// otherwise). Applications go only to a published listing whose
// organisation is verified, never from the organisation's own people, and
// one applicant keeps at most one open application per listing.
//
// Pure: the use case works out the applicant's age with #78's `ageAt` (from
// their profile's date of birth, or the one they type on the form) at the
// clock's instant, loads the listing and the applicant's grants, and passes
// the answers in. Loads under plain Node.

import type { ApplicationRecipient } from "./application-status";

/** The adoption listing's status, as #129 defines it. */
export type AdoptionListingStatus =
  | "draft"
  | "published"
  | "on_hold"
  | "adopted"
  | "withdrawn";

export type ApplicationEligibilityInput = {
  /** Completed years at the instant of applying; null when no birth date is known. */
  applicantAgeYears: number | null;
  minAgeYears: number;
  listing: { status: AdoptionListingStatus; organisationVerified: boolean };
  /** The applicant represents the organisation that listed the animal. */
  applicantRepresentsListing: boolean;
  /** The applicant already has an open application to this listing. */
  hasOpenApplication: boolean;
  /** They agreed to their contact being shared with the listing organisation. */
  sharingConsent: boolean;
};

export type ApplicationEligibilityRefusal =
  /** Not published (draft, on hold, closed) or the organisation isn't verified. */
  | "listing_not_open"
  | "own_listing"
  /** No birth date on the profile or the form. */
  | "date_of_birth_required"
  | "under_min_age"
  | "already_applied"
  | "sharing_consent_required";

export type ApplicationEligibilityDecision =
  | {
      ok: true;
      status: "submitted";
      notify: readonly ApplicationRecipient[];
    }
  | { ok: false; reason: ApplicationEligibilityRefusal };

/**
 * Decides whether a new application may be made. Refusals come in a fixed
 * order, so the applicant sees the one that matters most: there's nothing to
 * apply to, then it's their own listing, then their age, a duplicate, and
 * last the consent they can still tick.
 */
export function decideNewApplication(
  input: ApplicationEligibilityInput
): ApplicationEligibilityDecision {
  const { listing } = input;
  if (listing.status !== "published" || !listing.organisationVerified) {
    return { ok: false, reason: "listing_not_open" };
  }
  if (input.applicantRepresentsListing) {
    return { ok: false, reason: "own_listing" };
  }
  if (input.applicantAgeYears === null) {
    return { ok: false, reason: "date_of_birth_required" };
  }
  if (input.applicantAgeYears < input.minAgeYears) {
    return { ok: false, reason: "under_min_age" };
  }
  if (input.hasOpenApplication) {
    return { ok: false, reason: "already_applied" };
  }
  if (!input.sharingConsent) {
    return { ok: false, reason: "sharing_consent_required" };
  }
  return {
    ok: true,
    status: "submitted",
    notify: ["applicant", "listing_owner"],
  };
}
