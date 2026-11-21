// How a student is recognised when the same child is entered twice (#75,
// reused by the CSV import #76). The date of birth is encrypted, so the
// database can't compare it; instead each profile stores a keyed hash of
// this key (the blind-index helper from #58 does the hashing). The key
// carries a purpose and version, so it never collides with another blind
// index made with the same secret.
//
// Pure. Loads under plain Node.

import { type CalendarDate, formatIsoDate } from "./calendar-date";

const PURPOSE = "student-identity:v1:";

/**
 * A name as matching sees it: accents on Latin letters removed, lower
 * case, single spaces. Only the Latin combining accents (U+0300 to U+036F)
 * go: vowel signs in Indic scripts are letters of the name and stay.
 */
export function normaliseNameForMatching(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** What gets hashed for a student: purpose, normalised name and DOB. */
export function identityKeyInput(
  fullName: string,
  dateOfBirth: CalendarDate
): string {
  return `${PURPOSE}${normaliseNameForMatching(fullName)}|${formatIsoDate(dateOfBirth)}`;
}
