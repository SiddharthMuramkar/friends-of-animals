// Who may bid: adults only. Before a first bid a user saves a bidder
// profile (full name, date of birth, phone) and accepts the current terms
// of sale; every bid checks the user is still eligible.
//
// A user counts as a minor when any age we know for them is under 18: the
// date of birth on their bidder profile, or on a participant profile they
// log into or own as themselves, or when a guardian is linked to their login
// (a 13- to 17-year-old's own login always has one). Records we hold win
// over what the user types, so a teen can't bid by declaring an adult date
// of birth.
//
// Pure: the use cases read the facts, work out ages in completed years on
// India's calendar at the clock's instant (the participants module's
// `ageAt`) and pass them in. Dates of birth are stored, never ages.

/** The age from which a person may bid. */
export const BIDDER_MIN_AGE = 18;

/** What we already hold about the user, apart from the bidder profile. */
type KnownFacts = {
  /** Ages from participant profiles linked to this user. */
  knownAgesYears: readonly number[];
  /** True when a guardian is linked to this user's login. */
  hasActiveGuardianLink: boolean;
};

function recordsSayMinor(facts: KnownFacts): boolean {
  return (
    facts.hasActiveGuardianLink ||
    facts.knownAgesYears.some((age) => age < BIDDER_MIN_AGE)
  );
}

export type BidderProfileDecision =
  | { ok: true }
  | { ok: false; reason: "minor" | "dob_invalid" | "terms_not_accepted" };

/**
 * May the user save this bidder profile? `declaredAgeYears` is null when
 * the date of birth they typed could not be read.
 */
export function decideBidderProfile(
  input: KnownFacts & {
    declaredAgeYears: number | null;
    acceptedTermsVersion: string | null;
    currentTermsVersion: string;
  }
): BidderProfileDecision {
  if (recordsSayMinor(input)) return { ok: false, reason: "minor" };
  if (input.declaredAgeYears === null) {
    return { ok: false, reason: "dob_invalid" };
  }
  if (input.declaredAgeYears < BIDDER_MIN_AGE) {
    return { ok: false, reason: "minor" };
  }
  if (input.acceptedTermsVersion !== input.currentTermsVersion) {
    return { ok: false, reason: "terms_not_accepted" };
  }
  return { ok: true };
}

export type BidderEligibility =
  | { ok: true }
  | {
      ok: false;
      reason: "minor" | "bidder_profile_required" | "terms_not_accepted";
    };

/** May the user bid now? Checked on every bid, before the lot is locked. */
export function decideBidderEligibility(
  input: KnownFacts & {
    profile: { ageYears: number; acceptedTermsVersion: string } | null;
    currentTermsVersion: string;
  }
): BidderEligibility {
  if (recordsSayMinor(input)) return { ok: false, reason: "minor" };
  if (input.profile === null) {
    return { ok: false, reason: "bidder_profile_required" };
  }
  if (input.profile.ageYears < BIDDER_MIN_AGE) {
    return { ok: false, reason: "minor" };
  }
  if (input.profile.acceptedTermsVersion !== input.currentTermsVersion) {
    return { ok: false, reason: "terms_not_accepted" };
  }
  return { ok: true };
}
