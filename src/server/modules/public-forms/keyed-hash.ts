// Keyed hashes for what public forms must recognise but never keep: a
// sender's IP network and address in the limiter, and the IP on a stored
// message. HMAC-SHA-256 with the purpose hashed in, so one value hashes
// differently in each place, and nobody without the key can tell which
// value a hash belongs to.
//
// The key is the app's auth secret, as the sign-in limiter's keys are
// (src/server/identity/rate-limit.ts). #58's blind index has this shape;
// once it is on trunk, `formKeyedHash` returns `deps.blindIndex` instead.
//
// Loads under plain Node, so no "server-only" here.

import { createHmac } from "node:crypto";

export interface KeyedHash {
  /** The hash of an already normalised `value` used for `purpose`. */
  of(purpose: string, value: string): string;
}

export function keyedHash(secret: string): KeyedHash {
  return {
    of(purpose, value) {
      // The NUL separators keep ("a", "b\0c") and ("a\0b", "c") apart.
      return createHmac("sha256", secret)
        .update(`public-forms\0${purpose}\0${value}`)
        .digest("hex");
    },
  };
}

/** The keyed hash public forms use, from the use case's deps. */
export function formKeyedHash(deps: { auth: { secret: string } }): KeyedHash {
  return keyedHash(deps.auth.secret);
}
