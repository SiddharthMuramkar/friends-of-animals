// Whether a signed-in account is known to be a minor's (#106): adults only
// may give or bid (#55). An account is a minor's when its own participant profile
// (#78), or the child profile it signs in to as a teen (#81), holds a date
// of birth under 18 on India's calendar at `now`. An account with neither
// is not known to be a minor's: a donor or bidder still declares being an adult.
//
// Loads under plain Node: relative imports only.

import { eq, or } from "drizzle-orm";

import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import { participantProfile } from "../../db/schema";
import { isAdultAt } from "./domain/age";
import { parseIsoDate } from "../registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../registration/student-profile";

export async function isKnownMinor(
  db: AppDb,
  cipher: FieldCipher,
  userId: string,
  now: Date
): Promise<boolean> {
  const profiles = await db
    .select({
      dob: participantProfile.dobCiphertext,
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
      loginUserId: participantProfile.loginUserId,
    })
    .from(participantProfile)
    .where(
      or(
        eq(participantProfile.ownerUserId, userId),
        eq(participantProfile.loginUserId, userId)
      )
    );
  // A guardian owns their children's profiles: only the account's own
  // profile, or the one it signs in to, says how old it is.
  const own = profiles.filter(
    (profile) =>
      profile.loginUserId === userId ||
      (profile.ownerKind === "self" && profile.ownerUserId === userId)
  );
  return own.some((profile) => {
    const dateOfBirth = parseIsoDate(
      cipher.decrypt(PROFILE_PURPOSE.dob, profile.dob)
    );
    if (!dateOfBirth) throw new Error("A stored date of birth is not a date");
    return !isAdultAt(dateOfBirth, now);
  });
}
