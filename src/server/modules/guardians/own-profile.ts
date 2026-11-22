// The account's own participant profile (#78), as who may become a guardian
// or a child's login weighs it (81b): none, an adult's, or a minor's. A
// 13- to 17-year-old who registers alone keeps a profile of their own
// holding their date of birth, held for the guardian they asked, so the
// account is known to be a minor's: it never accepts a teen login
// invitation (./teen-login.ts), declares as a guardian
// (./register-guardian.ts) or accepts another teen's guardian request
// (./guardian-request.ts).
//
// Read under the user's row lock, which registering as an individual also
// takes, so neither slips past the other.

import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { participantProfile } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { isAdultAt } from "../participants/domain/age";
import { parseIsoDate } from "../registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../registration/student-profile";

export type OwnProfile = "none" | "adult" | "minor";

/** The user's own profile, by its date of birth at `now`. */
export async function ownProfileOf(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "cipher">,
  userId: string,
  now: Date
): Promise<OwnProfile> {
  const [own] = await tx
    .select({ dobCiphertext: participantProfile.dobCiphertext })
    .from(participantProfile)
    .where(
      and(
        eq(participantProfile.ownerUserId, userId),
        eq(participantProfile.ownerKind, "self")
      )
    );
  if (!own) return "none";
  const dateOfBirth = parseIsoDate(
    ctx.cipher.decrypt(PROFILE_PURPOSE.dob, own.dobCiphertext)
  );
  if (!dateOfBirth) throw new Error("A stored date of birth is not a date");
  return isAdultAt(dateOfBirth, now) ? "adult" : "minor";
}
