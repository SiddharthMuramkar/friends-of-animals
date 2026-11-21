// The FOA Participant ID: `FOA-P-` + the two-digit year it was issued (on
// India's calendar) + six Crockford base32 symbols, e.g. FOA-P-277K3M9Q.
// It is a human code, kept apart from the profile's UUIDv7 id, and is never
// a sign-in credential.
//
// The six symbols come from the codes module (crypto-random, with a retry
// when the unique index refuses a repeat); this file only builds the code
// from them. Pure; loads under plain Node.

import { indianDateAt } from "./indian-calendar";

/** Crockford base32 without I, L, O and U, upper case. */
const SIX_SYMBOLS = /^[0-9A-HJKMNP-TV-Z]{6}$/;

/**
 * The Participant ID issued at `issuedAt` with the random part `symbols`.
 * Throws a RangeError unless `symbols` is six upper-case Crockford base32
 * characters.
 */
export function participantCode(issuedAt: Date, symbols: string): string {
  if (!SIX_SYMBOLS.test(symbols)) {
    throw new RangeError(
      "A Participant ID needs six Crockford base32 symbols (0-9, A-Z without I, L, O, U)"
    );
  }
  const year = String(indianDateAt(issuedAt).year % 100).padStart(2, "0");
  return `FOA-P-${year}${symbols}`;
}
