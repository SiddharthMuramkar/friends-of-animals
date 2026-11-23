// The six-digit code a guardian enters after opening a consent link. It is
// scoped to one link: store a digest keyed with the app's auth secret.
// Online guessing is bounded by the attempts and sends in ./link.ts.
//
// Loads under plain Node (the seed script): relative imports only.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Digits in a code. */
export const CODE_DIGITS = 6;

/** Fills a buffer with random 32-bit words; tests may pass a fixed source. */
export type RandomWords = (count: number) => Uint32Array;

const cryptoWords: RandomWords = (count) =>
  crypto.getRandomValues(new Uint32Array(count));

const RANGE = 10 ** CODE_DIGITS;
// The largest multiple of RANGE below 2^32: words at or above it would make
// low codes likelier, so they are drawn again.
const LIMIT = Math.floor(2 ** 32 / RANGE) * RANGE;

/** A uniformly random code, with leading zeros kept. */
export function createOneTimeCode(random: RandomWords = cryptoWords): string {
  for (;;) {
    for (const word of random(4)) {
      if (word < LIMIT) {
        return (word % RANGE).toString().padStart(CODE_DIGITS, "0");
      }
    }
  }
}

/** Whether `value` could be a code, after spaces are taken out. */
export function normaliseOneTimeCode(value: string): string | null {
  const digits = value.replace(/\s+/g, "");
  return new RegExp(`^\\d{${CODE_DIGITS}}$`).test(digits) ? digits : null;
}

/** The digest a link's current code is stored as: HMAC-SHA-256 hex. */
export function hashOneTimeCode(
  secret: string,
  linkId: string,
  code: string
): string {
  return createHmac("sha256", secret)
    .update(`consent-link-code:${linkId}\0${code}`)
    .digest("hex");
}

/** Whether `entered` is the code stored as `storedHash`, in constant time. */
export function oneTimeCodeMatches(
  secret: string,
  linkId: string,
  entered: string,
  storedHash: string | null
): boolean {
  const code = normaliseOneTimeCode(entered);
  if (code === null || storedHash === null) return false;
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashOneTimeCode(secret, linkId, code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
