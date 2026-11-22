// A user's guardian record (#81): how its encrypted fields are named for
// the field cipher and blind index, and reading it back. Loads under plain
// Node (the seed script): relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { E164Phone } from "../../../lib/phone";
import type { BlindIndex } from "../../crypto/blind-index";
import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import { guardian } from "../../db/schema";

/** The purposes the cipher and blind index bind a guardian's fields to. */
export const GUARDIAN_PURPOSE = {
  fullName: "guardian.full_name",
  phone: "guardian.phone",
} as const;

/** The columns that store a guardian's name and optional phone. */
export function storedGuardianDetails(
  deps: { cipher: FieldCipher; blindIndex: BlindIndex },
  details: { fullName: string; phone: E164Phone | null }
): {
  fullNameCiphertext: Ciphertext;
  phoneCiphertext: Ciphertext | null;
  phoneHash: string | null;
} {
  return {
    fullNameCiphertext: deps.cipher.encrypt(
      GUARDIAN_PURPOSE.fullName,
      details.fullName
    ),
    phoneCiphertext:
      details.phone === null
        ? null
        : deps.cipher.encrypt(GUARDIAN_PURPOSE.phone, details.phone),
    phoneHash:
      details.phone === null
        ? null
        : deps.blindIndex.of(GUARDIAN_PURPOSE.phone, details.phone),
  };
}

/** A guardian's name, read back. */
export function guardianName(
  { cipher }: { cipher: FieldCipher },
  row: { fullNameCiphertext: string }
): string {
  return cipher.decrypt(GUARDIAN_PURPOSE.fullName, row.fullNameCiphertext);
}

/** A guardian's phone, read back, or null. */
export function guardianPhone(
  { cipher }: { cipher: FieldCipher },
  row: { phoneCiphertext: string | null }
): string | null {
  return row.phoneCiphertext === null
    ? null
    : cipher.decrypt(GUARDIAN_PURPOSE.phone, row.phoneCiphertext);
}

/** The guardian record of `userId`, if they have declared one. */
export async function guardianOfUser(db: AppDb, userId: string) {
  const [row] = await db
    .select()
    .from(guardian)
    .where(eq(guardian.userId, userId));
  return row ?? null;
}
