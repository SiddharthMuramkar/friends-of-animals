// A volunteer application's row (#123): how its encrypted fields are named
// for the field cipher, where the applicant's date of birth comes from,
// and loading and locking one application. Loads under plain Node (the
// worker and the seed script): relative imports only, no "server-only".

import { and, desc, eq } from "drizzle-orm";

import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import { participantProfile, volunteerApplication } from "../../db/schema";
import {
  parseIsoDate,
  type CalendarDate,
} from "../registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../registration/student-profile";

/** The purposes the cipher binds an application's fields to. */
export const DATE_OF_BIRTH_PURPOSE = "volunteer_application.dob";
export const DECLINE_REASON_PURPOSE = "volunteer_application.decline_reason";

/**
 * The participant profile an applicant's age comes from: the
 * guardian-kept profile a teen's login is linked to, or else an adult's
 * own. A teen can't type an older date than their guardian entered.
 */
export async function applicantProfileOf(
  db: AppDb,
  cipher: FieldCipher,
  userId: string
): Promise<{
  id: string;
  ownerKind: "guardian" | "self";
  dateOfBirth: CalendarDate;
} | null> {
  const [linked] = await db
    .select({
      id: participantProfile.id,
      dobCiphertext: participantProfile.dobCiphertext,
    })
    .from(participantProfile)
    .where(eq(participantProfile.loginUserId, userId));
  const [own] = linked
    ? []
    : await db
        .select({
          id: participantProfile.id,
          dobCiphertext: participantProfile.dobCiphertext,
        })
        .from(participantProfile)
        .where(
          and(
            eq(participantProfile.ownerUserId, userId),
            eq(participantProfile.ownerKind, "self")
          )
        );
  const found = linked ?? own;
  if (!found) return null;
  const dateOfBirth = parseIsoDate(
    cipher.decrypt(PROFILE_PURPOSE.dob, found.dobCiphertext)
  );
  if (!dateOfBirth) throw new Error("A stored date of birth is not a date");
  return {
    id: found.id,
    ownerKind: linked ? "guardian" : "self",
    dateOfBirth,
  };
}

/** One application, locked until the transaction ends; null if none. */
export async function lockApplication(tx: AppDb, applicationId: string) {
  const [row] = await tx
    .select()
    .from(volunteerApplication)
    .where(eq(volunteerApplication.id, applicationId))
    .for("update");
  return row ?? null;
}

/** The user's newest application, if they ever applied. */
export async function latestApplicationOf(db: AppDb, userId: string) {
  const [row] = await db
    .select()
    .from(volunteerApplication)
    .where(eq(volunteerApplication.applicantUserId, userId))
    .orderBy(desc(volunteerApplication.createdAt), desc(volunteerApplication.id))
    .limit(1);
  return row ?? null;
}
