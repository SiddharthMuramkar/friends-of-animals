// How a participant is named wherever their work is shown in public: the
// gallery, results, social media and auctions all ask here, so a minor is
// never shown with more than their guardian allowed. A minor is credited by
// first name and last initial; school and city are added only for the
// fields the guardian opted in to, and never on a minor's auction credit.
// Nothing is stored: the credit is worked out from the profile and the
// consents each time.
//
// Pure: loads under plain Node, relative imports only.

import {
  publicUseOf,
  type GuardianPurpose,
  type PublicUse,
} from "./guardian-purposes";

export type CreditPerson = {
  firstName: string;
  lastName: string;
  schoolName?: string | null;
  city?: string | null;
  /**
   * Under 18 when the work was entered. Work made as a child keeps a
   * child's credit after the creator turns 18.
   */
  minor: boolean;
};

/** Everything a public page may show about who made the work. */
export type PublicCredit = { name: string; school?: string; city?: string };

/**
 * The credit for one public use of this person's work, or null when the
 * consents don't allow that use (or there is no name to show).
 */
export function resolvePublicCredit(
  person: CreditPerson,
  use: PublicUse,
  given: ReadonlySet<GuardianPurpose>
): PublicCredit | null {
  const permission = publicUseOf(given, use, person);
  if (!permission.allowed) return null;
  const name = person.minor
    ? firstNameAndInitial(person.firstName, person.lastName)
    : tidy(`${person.firstName} ${person.lastName}`);
  if (!name) return null;
  const credit: PublicCredit = { name };
  const school = present(person.schoolName);
  if (school && permission.showSchool) credit.school = school;
  const city = present(person.city);
  if (city && permission.showCity) credit.city = city;
  return credit;
}

const graphemes = new Intl.Segmenter("en-IN", { granularity: "grapheme" });
const LETTER = /\p{L}/u;

/** NFC, trimmed, with runs of white space as one space. */
function tidy(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/**
 * The surname's first letter as the reader sees it: a whole grapheme, so a
 * Devanagari consonant keeps its vowel sign and an accent stays on its
 * letter. Punctuation before it is skipped.
 */
function initialOf(lastName: string): string | undefined {
  for (const { segment } of graphemes.segment(tidy(lastName))) {
    if (LETTER.test(segment)) return segment.toLocaleUpperCase("en-IN");
  }
  return undefined;
}

function firstNameAndInitial(firstName: string, lastName: string): string {
  const initial = initialOf(lastName);
  return [tidy(firstName), initial && `${initial}.`].filter(Boolean).join(" ");
}

function present(value: string | null | undefined): string | undefined {
  const tidied = value ? tidy(value) : "";
  return tidied || undefined;
}
