// The consent catalogue: what a consent document is for, how consent is
// given and whose consent it is. The schema's Postgres enums and the use
// cases' input schemas read these lists, so they agree. Adding a value later
// needs its own migration, unused in the migration that adds it.
//
// Loads under plain Node (schema, seed): relative imports only.

import { GUARDIAN_PURPOSES } from "./guardian-purposes";

/**
 * The two declarations a volunteer applicant makes (#123): the safeguarding
 * declaration and the code of conduct. Each is a document staff publish;
 * the volunteers module records the applicant's acceptance when they apply
 * (or accept a newer version), never through `giveConsent`, and a
 * community manager's approval needs both on their current versions.
 */
export const VOLUNTEER_PURPOSES = [
  "volunteer_safeguarding_declaration",
  "volunteer_code_of_conduct",
] as const;
export type VolunteerPurpose = (typeof VOLUNTEER_PURPOSES)[number];

/**
 * `competition_terms` is a competition's own terms (#72), apart from the
 * site's terms of use. The guardian purposes (#82) follow: what a verified
 * guardian gives and withdraws for a child (./guardian-purposes.ts). Then
 * the volunteer declarations (#123).
 */
export const CONSENT_PURPOSES = [
  "privacy_notice",
  "terms",
  "messages",
  "competition_terms",
  ...GUARDIAN_PURPOSES,
  ...VOLUNTEER_PURPOSES,
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * Purposes with a document of their own, which staff publish. Showing the
 * school and the city are options of the public credit: consent to them
 * points at the public display document.
 */
export const DOCUMENT_PURPOSES = CONSENT_PURPOSES.filter(
  (purpose) => purpose !== "display_school" && purpose !== "display_city"
);

/**
 * Purposes a person gives and withdraws for themselves. The others are
 * notices, whose current version is what the legal pages show, and the
 * guardian purposes, which a guardian gives for a child.
 */
export const GIVABLE_PURPOSES = [
  "messages",
] as const satisfies readonly ConsentPurpose[];
export type GivablePurpose = (typeof GIVABLE_PURPOSES)[number];

/** Every purpose whose consent can be withdrawn, by its subject or a guardian. */
export const WITHDRAWABLE_PURPOSES = [
  ...GIVABLE_PURPOSES,
  ...GUARDIAN_PURPOSES,
] as const satisfies readonly ConsentPurpose[];
export type WithdrawablePurpose = (typeof WITHDRAWABLE_PURPOSES)[number];

/** The legal page that shows each notice's current version. */
export const LEGAL_PAGE_PURPOSE = {
  privacy: "privacy_notice",
  terms: "terms",
} as const satisfies Record<string, ConsentPurpose>;

/**
 * Only `web_form` is recorded now, by the person themselves or a verified
 * guardian (#82); coordinators' code links and signed forms come with #83.
 */
export const CONSENT_METHODS = [
  "web_form",
  "otp_link",
  "paper_form",
  "staff_recorded",
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/**
 * Whose consent it is: a user's own, or a child's participant profile,
 * given by their guardian (#82).
 */
export const CONSENT_SUBJECT_TYPES = ["user", "participant_profile"] as const;
export type ConsentSubjectType = (typeof CONSENT_SUBJECT_TYPES)[number];
