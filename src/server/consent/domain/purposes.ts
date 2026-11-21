// The consent catalogue: what a consent document is for, how consent is
// given and whose consent it is. The schema's Postgres enums and the use
// cases' input schemas read these lists, so they agree. Adding a value later
// needs its own migration, unused in the migration that adds it.
//
// Loads under plain Node (schema, seed): relative imports only.

/**
 * `competition_terms` is a competition's own terms (#72), apart from the
 * site's terms of use. #82 adds participation, public display and the
 * other guardian purposes.
 */
export const CONSENT_PURPOSES = [
  "privacy_notice",
  "terms",
  "messages",
  "competition_terms",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * Purposes a person gives and withdraws. The others are notices: their
 * current version is what the legal pages show.
 */
export const GIVABLE_PURPOSES = [
  "messages",
] as const satisfies readonly ConsentPurpose[];
export type GivablePurpose = (typeof GIVABLE_PURPOSES)[number];

/** The legal page that shows each notice's current version. */
export const LEGAL_PAGE_PURPOSE = {
  privacy: "privacy_notice",
  terms: "terms",
} as const satisfies Record<string, ConsentPurpose>;

/** M0 records only `web_form`; guardian links and paper forms arrive in M1. */
export const CONSENT_METHODS = [
  "web_form",
  "otp_link",
  "paper_form",
  "staff_recorded",
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/** Whose consent it is. #82 adds participant profiles for minors. */
export const CONSENT_SUBJECT_TYPES = ["user"] as const;
export type ConsentSubjectType = (typeof CONSENT_SUBJECT_TYPES)[number];
