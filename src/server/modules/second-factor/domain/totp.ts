// Time-based one-time passwords (TOTP, RFC 6238) for staff authenticator
// apps. FOA verifies codes itself, against the injected clock, so tests
// drive code expiry with the fake clock and no provider is involved.
// Parameters are the ones every authenticator app defaults to: HMAC-SHA-1,
// six digits, 30-second steps. Pure apart from the default random source.

import { createHmac, timingSafeEqual } from "node:crypto";

import { base32Encode } from "./base32";

export const TOTP = {
  digits: 6,
  periodSeconds: 30,
  /** Steps accepted either side of now, for a phone whose clock drifts. */
  skewSteps: 1,
  secretBytes: 20,
} as const;

/** Returns `length` random bytes; tests may pass a fixed source. */
export type RandomBytes = (length: number) => Uint8Array;

const cryptoRandom: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

/** A new 160-bit shared secret (the size RFC 4226 recommends). */
export function generateTotpSecret(
  random: RandomBytes = cryptoRandom
): Uint8Array {
  return random(TOTP.secretBytes).slice(0, TOTP.secretBytes);
}

function stepAt(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP.periodSeconds);
}

/** HOTP (RFC 4226 section 5.3) for one counter value. */
function hotp(secret: Uint8Array, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP.digits).padStart(TOTP.digits, "0");
}

/** The code an authenticator app shows at `at`. */
export function totpCode(secret: Uint8Array, at: Date): string {
  return hotp(secret, stepAt(at));
}

export type TotpCheck =
  | { ok: true; step: number }
  | { ok: false; reason: "malformed" | "wrong_code" | "reused" };

/**
 * Checks a code typed by the person, allowing one step of clock drift each
 * way. A code is accepted once: pass the step of the last accepted code as
 * `lastUsedStep`, and store the returned `step` when it succeeds, so a code
 * seen over someone's shoulder can't be replayed.
 */
export function verifyTotp(input: {
  secret: Uint8Array;
  code: string;
  at: Date;
  lastUsedStep: number | null;
}): TotpCheck {
  const code = input.code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${TOTP.digits}}$`).test(code)) {
    return { ok: false, reason: "malformed" };
  }
  const typed = Buffer.from(code);
  const now = stepAt(input.at);
  let matched: number | null = null;
  // Compare against every step in the window, without stopping early, so
  // timing doesn't reveal which step matched.
  for (let step = now - TOTP.skewSteps; step <= now + TOTP.skewSteps; step++) {
    const expected = Buffer.from(hotp(input.secret, step));
    if (timingSafeEqual(expected, typed) && matched === null) matched = step;
  }
  if (matched === null) return { ok: false, reason: "wrong_code" };
  if (input.lastUsedStep !== null && matched <= input.lastUsedStep) {
    return { ok: false, reason: "reused" };
  }
  return { ok: true, step: matched };
}

/**
 * The otpauth:// link (Google Authenticator key URI format) that the
 * enrolment QR code holds. Parts are percent-encoded rather than form
 * encoded, because some apps show a `+` for a space.
 */
export function otpauthUri(input: {
  issuer: string;
  account: string;
  secret: Uint8Array;
}): string {
  const issuer = encodeURIComponent(input.issuer);
  const label = `${issuer}:${encodeURIComponent(input.account)}`;
  const query = [
    `secret=${base32Encode(input.secret)}`,
    `issuer=${issuer}`,
    "algorithm=SHA1",
    `digits=${TOTP.digits}`,
    `period=${TOTP.periodSeconds}`,
  ].join("&");
  return `otpauth://totp/${label}?${query}`;
}
