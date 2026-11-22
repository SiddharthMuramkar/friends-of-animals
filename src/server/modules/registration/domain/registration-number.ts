// A registration number (#77): the competition's code, "R" and six random
// Crockford base32 symbols (PAWS27-R-7KQ2M9), given once a registration is
// confirmed. Participants write it on the back of their artwork and quote
// it to FOA. Built with the codes module (#73), which retries a number
// that is already taken.
//
// Plain TypeScript with no imports at run time, so the seed script can load
// it under plain Node.

import type { CodeFormat } from "../../codes/codes";

/** How many random symbols follow `{code}-R-`. */
export const REGISTRATION_NUMBER_SYMBOL_COUNT = 6;

/** What every registration number looks like. */
export const REGISTRATION_NUMBER = /^[A-Z]{3,6}\d{2}-R-[0-9A-HJKMNP-TV-Z]{6}$/;

/** The number format for registrations in the competition `code`. */
export function registrationNumberFormat(competitionCode: string): CodeFormat {
  return {
    prefix: `${competitionCode}-R-`,
    length: REGISTRATION_NUMBER_SYMBOL_COUNT,
  };
}
