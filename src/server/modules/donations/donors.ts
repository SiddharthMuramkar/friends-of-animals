// The donor's personal data (#106): how it is sealed, found and read back.
// Name and email are encrypted under their column's purpose; the email's
// blind index finds a donor asking for a lost receipt link. Loads under
// plain Node (the worker): relative imports only.

import type { BlindIndex } from "../../crypto/blind-index";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { DonorRow } from "../../db/schema";
import { normaliseEmailAddress } from "../../ports/email";

export const DONOR_PURPOSE = {
  name: "donor.name",
  email: "donor.email",
  pan: "donor.pan",
} as const;

/** The blind index of an email address, as `donor.email_hash` stores it. */
export function donorEmailHash(blindIndex: BlindIndex, email: string): string {
  return blindIndex.of(DONOR_PURPOSE.email, normaliseEmailAddress(email));
}

/** The donor's name and email, decrypted. */
export function donorContact(
  cipher: FieldCipher,
  donor: Pick<DonorRow, "name" | "email">
): { name: string; email: string } {
  return {
    name: cipher.decrypt(DONOR_PURPOSE.name, donor.name),
    email: cipher.decrypt(DONOR_PURPOSE.email, donor.email),
  };
}
