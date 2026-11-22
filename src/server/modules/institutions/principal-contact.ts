// How an institution row stores its principal's email and phone: encrypted
// with the field cipher, each bound to its own column, so a raw query or a
// leaked backup shows neither. Loads under plain Node (the seed script):
// relative imports only, no "server-only".

import type { E164Phone } from "../../../lib/phone";
import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";

/** The purposes the cipher binds each value to. */
export const PRINCIPAL_EMAIL = "institution.principal_email";
export const PRINCIPAL_PHONE = "institution.principal_phone";

export type PrincipalContact = {
  principalEmail: string;
  principalPhone: E164Phone;
};

export type StoredPrincipalContact = {
  principalEmailCiphertext: Ciphertext;
  principalPhoneCiphertext: Ciphertext;
};

/** The columns that store the principal's contact details. */
export function sealPrincipalContact(
  { cipher }: { cipher: FieldCipher },
  contact: PrincipalContact
): StoredPrincipalContact {
  return {
    principalEmailCiphertext: cipher.encrypt(
      PRINCIPAL_EMAIL,
      contact.principalEmail
    ),
    principalPhoneCiphertext: cipher.encrypt(
      PRINCIPAL_PHONE,
      contact.principalPhone
    ),
  };
}

/** The principal's contact details, read back. */
export function openPrincipalContact(
  { cipher }: { cipher: FieldCipher },
  stored: StoredPrincipalContact
): PrincipalContact {
  return {
    principalEmail: cipher.decrypt(
      PRINCIPAL_EMAIL,
      stored.principalEmailCiphertext
    ),
    principalPhone: cipher.decrypt(
      PRINCIPAL_PHONE,
      stored.principalPhoneCiphertext
    ) as E164Phone,
  };
}
