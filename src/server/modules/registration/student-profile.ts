// How a student's details are stored on `participant_profile` (#75): the
// date of birth, phones, emails, the guardian's name and the address
// encrypted with the field cipher, each for its own column's purpose, and
// the rest plain. Shared by enrolling and the seed. Loads under plain Node
// (the seed script): relative imports only, no "server-only".

import { parsePhoneNumber } from "../../../lib/phone";
import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";
import { formatIsoDate } from "./domain/calendar-date";
import type {
  GuardianRelationship,
  StudentDetails,
} from "./domain/student-details";

/** #58's normaliser, as the student rules take it: E.164 or null. */
export function normaliseStudentPhone(raw: string): string | null {
  const parsed = parsePhoneNumber(raw);
  return parsed.ok ? parsed.e164 : null;
}

/** The purpose each encrypted column binds its values to. */
export const PROFILE_PURPOSE = {
  dob: "participant_profile.dob",
  phone: "participant_profile.phone",
  email: "participant_profile.email",
  guardianName: "participant_profile.guardian_name",
  guardianPhone: "participant_profile.guardian_phone",
  guardianEmail: "participant_profile.guardian_email",
  address: "participant_profile.address",
} as const;

export type StudentColumns = {
  fullName: string;
  dobCiphertext: Ciphertext;
  grade: string | null;
  studentRef: string | null;
  phoneCiphertext: Ciphertext | null;
  emailCiphertext: Ciphertext | null;
  guardianNameCiphertext: Ciphertext | null;
  guardianRelationship: GuardianRelationship | null;
  guardianPhoneCiphertext: Ciphertext | null;
  guardianEmailCiphertext: Ciphertext | null;
  addressCiphertext: Ciphertext | null;
  pinCode: string | null;
  city: string | null;
  state: string | null;
};

/** The profile columns that hold `details`. */
export function studentColumns(
  { cipher }: { cipher: FieldCipher },
  details: StudentDetails
): StudentColumns {
  const encrypt = (
    purpose: keyof typeof PROFILE_PURPOSE,
    value: string | null
  ): Ciphertext | null =>
    value === null ? null : cipher.encrypt(PROFILE_PURPOSE[purpose], value);
  const { contact } = details;
  const guardian = contact.kind === "guardian" ? contact : null;
  const self = contact.kind === "self" ? contact : null;
  return {
    fullName: details.fullName,
    dobCiphertext: cipher.encrypt(
      PROFILE_PURPOSE.dob,
      formatIsoDate(details.dateOfBirth)
    ),
    grade: details.grade,
    studentRef: details.studentRef,
    phoneCiphertext: encrypt("phone", self?.phone ?? null),
    emailCiphertext: encrypt("email", self?.email ?? null),
    guardianNameCiphertext: encrypt("guardianName", guardian?.name ?? null),
    guardianRelationship: guardian?.relationship ?? null,
    guardianPhoneCiphertext: encrypt("guardianPhone", guardian?.phone ?? null),
    guardianEmailCiphertext: encrypt("guardianEmail", guardian?.email ?? null),
    addressCiphertext: encrypt("address", details.address),
    pinCode: details.pinCode,
    city: details.city,
    state: details.state,
  };
}
