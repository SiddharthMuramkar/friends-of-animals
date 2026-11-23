// The Entry ID (#85): the competition's code, "E" and six random Crockford
// base32 symbols (PAWS27-E-7K3QZ9), given when an entry is created.
// Participants quote it to FOA; judges and the gallery show it instead of a
// name. Built with the codes module (#73), which retries an ID that is
// already taken.
//
// Pure: no I/O, no "server-only".

import type { CodeFormat } from "../../codes/codes";

/** How many random symbols follow `{code}-E-`. */
export const ENTRY_CODE_SYMBOL_COUNT = 6;

/** What every Entry ID looks like. */
export const ENTRY_CODE = /^[A-Z]{3,6}\d{2}-E-[0-9A-HJKMNP-TV-Z]{6}$/;

const COMPETITION_CODE = /^[A-Z]{3,6}\d{2}$/;

/**
 * The codes module's format for entries in the competition `code`. Throws
 * a RangeError for anything that isn't a competition code.
 */
export function entryCodeFormat(competitionCode: string): CodeFormat {
  if (!COMPETITION_CODE.test(competitionCode)) {
    throw new RangeError(
      "A competition code is 3 to 6 capital letters and a two-digit year"
    );
  }
  return { prefix: `${competitionCode}-E-`, length: ENTRY_CODE_SYMBOL_COUNT };
}

/**
 * An Entry ID as someone typed it or a URL carried it, in its stored form
 * (trimmed, upper case), or null if it isn't one.
 */
export function parseEntryCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return ENTRY_CODE.test(code) ? code : null;
}
