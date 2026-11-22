// The reference a sender is given for their message, such as
// `CM-27-8H3TZ0`: the IST year and 6 random Crockford base32 symbols
// (no I, L, O or U, so it reads back over the phone).

import { contactReferenceFormat } from "./domain/submission";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

type RandomBytes = (length: number) => Uint8Array;

const cryptoRandom: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

/** A fresh reference for a message arriving at `at`. Not checked unique. */
export function newContactReference(
  at: Date,
  random: RandomBytes = cryptoRandom
): string {
  const { prefix, length } = contactReferenceFormat(at);
  // 256 is a multiple of 32, so the low 5 bits of a byte are uniform.
  const symbols = Array.from(random(length), (byte) => CROCKFORD[byte & 31]);
  return prefix + symbols.join("");
}
