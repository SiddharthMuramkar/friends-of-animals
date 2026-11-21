// The certificate number, `FOA-C-{YY}-{10}`: the two-digit year it was
// issued (on India's calendar) and ten random Crockford base32 symbols,
// e.g. FOA-C-27-9XQ4M2T7KD. Ten symbols are 50 bits, so a number can't be
// guessed; the public verification page also rate-limits lookups.
//
// The random symbols come from the codes module (crypto-random, with a
// retry when the unique index refuses a repeat), given the format below.
// This file only describes the format and reads what people type.
//
// Pure: no database, no clock of its own. Loads under plain Node.

/** A stored certificate number: upper case, hyphens, Crockford symbols. */
export const CERTIFICATE_NUMBER_PATTERN =
  /^FOA-C-\d{2}-[0-9A-HJKMNP-TV-Z]{10}$/;

const SYMBOL_COUNT = 10;

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Longer input than this is never a number, however it is spaced. */
const MAX_INPUT_LENGTH = 64;

/** Whether `value` is a certificate number exactly as it is stored. */
export function isCertificateNumber(value: string): boolean {
  return CERTIFICATE_NUMBER_PATTERN.test(value);
}

/**
 * The code format for numbers issued at `issuedAt`: the prefix carries the
 * year on India's calendar, so a certificate issued just after midnight
 * IST on 1 January carries the new year.
 */
export function certificateNumberFormat(issuedAt: Date): {
  prefix: string;
  length: number;
} {
  const year = new Date(issuedAt.getTime() + IST_OFFSET_MS).getUTCFullYear();
  const yy = String(year % 100).padStart(2, "0");
  return { prefix: `FOA-C-${yy}-`, length: SYMBOL_COUNT };
}

// What a person may type: any case, spaces anywhere, hyphens optional.
const TYPED_NUMBER = /^FOA-?C-?([0-9A-Z]{2})-?([0-9A-Z]{10})$/;

/** Crockford decoding: O reads as 0, I and L read as 1. */
function decodeLookalikes(symbols: string): string {
  return symbols.replace(/O/g, "0").replace(/[IL]/g, "1");
}

/**
 * Reads a number as someone typed or scanned it and returns the stored
 * form, or `null` when it can't be a certificate number. Case, spaces and
 * missing hyphens are forgiven, and O, I and L in the year or the code are
 * read as the digits they look like. U is never part of a number.
 */
export function normaliseCertificateNumber(input: string): string | null {
  if (input.length > MAX_INPUT_LENGTH) return null;
  const typed = TYPED_NUMBER.exec(input.replace(/\s+/g, "").toUpperCase());
  if (!typed) return null;
  const number = `FOA-C-${decodeLookalikes(typed[1]!)}-${decodeLookalikes(typed[2]!)}`;
  return isCertificateNumber(number) ? number : null;
}

/** The public verification page for `number`, which the QR code links to. */
export function verifyPathFor(number: string): string {
  if (!isCertificateNumber(number)) {
    throw new RangeError(
      `Not a stored certificate number: ${JSON.stringify(number)}`
    );
  }
  return `/verify/${number}`;
}
