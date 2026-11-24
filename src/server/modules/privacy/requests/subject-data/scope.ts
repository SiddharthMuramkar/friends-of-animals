// Whose records a rights request reaches (#115b). A request names an
// account or a participant profile; its scope is every account and
// profile that are that same person:
//
//   an account      → itself, its own adult profile (#78), and the child
//                     profile its teen login belongs to (#81)
//   a profile       → itself, and its teen login account if it has one
//
// A guardian's children are not in the guardian's scope: each child is a
// person of their own, whose rights the guardian uses by filing for them.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, or } from "drizzle-orm";

import type { AppDb } from "../../../../db/app-db";
import { participantProfile } from "../../../../db/schema";
import type { PrivacySubjectKind } from "../domain/filing";

export type SubjectScope = {
  userIds: readonly string[];
  profileIds: readonly string[];
};

export async function subjectScope(
  db: AppDb,
  subject: { subjectKind: PrivacySubjectKind; subjectId: string }
): Promise<SubjectScope> {
  if (subject.subjectKind === "user") {
    const profiles = await db
      .select({ id: participantProfile.id })
      .from(participantProfile)
      .where(
        or(
          eq(participantProfile.loginUserId, subject.subjectId),
          and(
            eq(participantProfile.ownerUserId, subject.subjectId),
            eq(participantProfile.ownerKind, "self")
          )
        )
      )
      .orderBy(participantProfile.id);
    return {
      userIds: [subject.subjectId],
      profileIds: profiles.map((profile) => profile.id),
    };
  }
  const [profile] = await db
    .select({ loginUserId: participantProfile.loginUserId })
    .from(participantProfile)
    .where(eq(participantProfile.id, subject.subjectId));
  return {
    userIds: profile?.loginUserId ? [profile.loginUserId] : [],
    profileIds: [subject.subjectId],
  };
}
