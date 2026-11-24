// Orphaned participant profiles (finding carried from #78). An adult's own
// profile, or a guardian's child's, keeps its owner account in
// owner_user_id; deleting that account sets it to null (ON DELETE SET
// NULL), which would leave the name, encrypted date of birth and phone
// behind with nobody to answer for them. A profile that never entered a
// competition has nothing left to keep it, so the next sweep deletes it.
// One with entries stays for the participant period like any other
// (WHILE_STUDENT_TAKES_PART); the erasure flow (#115b) anonymises those.
// A teen with their own login (#81) keeps their profile.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, isNull, ne, sql } from "drizzle-orm";

import { participantProfile, registration } from "../../../db/schema";
import { rowPolicy } from "./define";

export const ORPHANED_PROFILES = rowPolicy({
  key: "orphanedProfiles",
  table: participantProfile,
  action: "delete",
  period: { kind: "fixed" },
  // Fixed: an orphan may go at the next run; its last change is in the past.
  anchor: participantProfile.updatedAt,
  where: and(
    ne(participantProfile.ownerKind, "institution"),
    isNull(participantProfile.ownerUserId),
    isNull(participantProfile.loginUserId),
    sql`NOT EXISTS (SELECT 1 FROM ${registration} WHERE ${registration.participantProfileId} = ${participantProfile.id})`
  ),
  subjects: [["participant_profile", participantProfile.id]],
});
