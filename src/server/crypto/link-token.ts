// Secret link tokens: the bearer part of a link sent to one person, such as
// a coordinator invitation (#74), and later a teen's guardian link or a
// guardian consent link. Only the SHA-256 hash is stored and looked up; a
// 256-bit random token needs no key or salt against guessing.
//
// Not a human-facing code (those are short Crockford base32) and never a
// credential on its own: the use case behind the link still checks who is
// acting. Loads under plain Node (the seed script): relative imports only,
// no "server-only".

import { createHash } from "node:crypto";

/** Random bytes per token: 256 bits. */
export const LINK_TOKEN_BYTES = 32;

/** Returns `size` random bytes; tests may pass a fixed source. */
export type RandomBytes = (size: number) => Uint8Array;

const cryptoRandom: RandomBytes = (size) =>
  crypto.getRandomValues(new Uint8Array(size));

/** 32 bytes in base64url without padding are always 43 characters. */
const WELL_FORMED = /^[A-Za-z0-9_-]{43}$/;

export type LinkToken = {
  /** Goes in the link, once. Never stored in plain text or logged. */
  token: string;
  /** What the database stores and looks the link up by. */
  tokenHash: string;
};

/** The hash a link token is stored and found by: SHA-256, lower-case hex. */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new token and its hash. */
export function createLinkToken(random: RandomBytes = cryptoRandom): LinkToken {
  const bytes = random(LINK_TOKEN_BYTES);
  if (bytes.length < LINK_TOKEN_BYTES) {
    throw new RangeError(
      `A link token needs ${LINK_TOKEN_BYTES} random bytes, got ${bytes.length}`
    );
  }
  const token = Buffer.from(bytes.subarray(0, LINK_TOKEN_BYTES)).toString(
    "base64url"
  );
  return { token, tokenHash: hashLinkToken(token) };
}

/**
 * Whether `value` could be a link token, so a mistyped or tampered link is
 * refused without a database lookup.
 */
export function isWellFormedLinkToken(value: string): boolean {
  return WELL_FORMED.test(value);
}
