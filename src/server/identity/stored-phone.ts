// How the user table stores a phone number: encrypted (phone_ciphertext)
// and as a blind index (phone_hash) to find the account by. Shared by the
// phone sign-in use cases and the seed. Loads under plain Node (seed
// script): relative imports only, no "server-only".

import type { E164Phone } from "../../lib/phone";
import type { BlindIndex } from "../crypto/blind-index";
import type { Ciphertext, FieldCipher } from "../crypto/field-cipher";

/** The purpose both the cipher and the blind index bind a phone to. */
export const USER_PHONE = "user.phone";

/** The blind index sign-in looks an account up by. */
export function phoneHashOf(
  { blindIndex }: { blindIndex: BlindIndex },
  phone: E164Phone
): string {
  return blindIndex.of(USER_PHONE, phone);
}

/** The columns that store `phone` on a user row. */
export function storedPhone(
  deps: { cipher: FieldCipher; blindIndex: BlindIndex },
  phone: E164Phone
): { phoneCiphertext: Ciphertext; phoneHash: string } {
  return {
    phoneCiphertext: deps.cipher.encrypt(USER_PHONE, phone),
    phoneHash: phoneHashOf(deps, phone),
  };
}

/** A stored phone, read back. */
export function readStoredPhone(
  { cipher }: { cipher: FieldCipher },
  stored: Ciphertext
): E164Phone {
  return cipher.decrypt(USER_PHONE, stored) as E164Phone;
}
