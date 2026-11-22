// Keyed hashes for what public forms must recognise but never keep: a
// sender's IP network and address in the limiter, and the IP on a stored
// message. They are #58's blind index: HMAC-SHA-256 under FIELD_HMAC_KEY,
// the key for hashes of personal data, with the purpose hashed in, so one
// value hashes differently in each place, and nobody without the key can
// tell which value a hash belongs to. Rotating the auth secret leaves them
// alone.
//
// Loads under plain Node, so no "server-only" here.

import type { BlindIndex } from "../../crypto/blind-index";

export type KeyedHash = BlindIndex;

/** The keyed hash public forms use, from the use case's deps. */
export function formKeyedHash(deps: { blindIndex: BlindIndex }): KeyedHash {
  return deps.blindIndex;
}
