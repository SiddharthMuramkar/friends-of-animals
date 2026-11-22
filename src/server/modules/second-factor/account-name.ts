// What an authenticator app or a passkey calls the account: the user's email
// address, or the phone number of an account made by phone (#58), which has
// no address. Loads under plain Node: relative imports only.

import { formatPhoneNumber } from "../../../lib/phone";
import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";
import { readStoredPhone } from "../../identity/stored-phone";

export function accountName(
  ctx: { cipher: FieldCipher },
  account: { email: string | null; phoneCiphertext: Ciphertext | null }
): string {
  if (account.email !== null) return account.email;
  if (account.phoneCiphertext !== null) {
    return formatPhoneNumber(readStoredPhone(ctx, account.phoneCiphertext));
  }
  // The user table refuses a row with neither (user_email_or_phone).
  throw new Error("The account has no email address or phone");
}
