// Who hears about a volunteer application (#123), for the notifications
// module's audiences, and what its messages may say.
//
// A teen's application is about a child, so FOA writes to their verified
// guardians and gives the teen only an inbox copy, as for every message
// about a minor (../guardians/domain/minor-audience.ts). An application is
// a teen's when the profile its date of birth came from is one a guardian
// keeps. An adult hears about their own application on every channel the
// route names. The community team hears that one is waiting.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq, isNull, inArray } from "drizzle-orm";

import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import {
  participantProfile,
  user,
  userRole,
  volunteerApplication,
  volunteerTaskAssignment,
  volunteerHoursEntry,
  volunteerTask,
} from "../../db/schema";
import { verifiedGuardianIds } from "../guardians/domain/minor-audience";
import { guardianLinksByProfile } from "../guardians/participant-audience";
import type { AudienceMember } from "../notifications/domain/audience-member";
import { DECLINE_REASON_PURPOSE } from "./application-record";

/** The variables every volunteer application message may use. */
export const APPLICATION_VARIABLES = ["applicant.name"] as const;

/** A declined application's message also says why. */
export const DECLINED_VARIABLES = [
  ...APPLICATION_VARIABLES,
  "decline.reason",
] as const;

async function applicationFacts(db: AppDb, applicationId: string) {
  const [row] = await db
    .select({
      applicantUserId: volunteerApplication.applicantUserId,
      applicantName: user.name,
      profileId: participantProfile.id,
      ownerKind: participantProfile.ownerKind,
      declineReasonCiphertext: volunteerApplication.declineReasonCiphertext,
    })
    .from(volunteerApplication)
    .innerJoin(user, eq(user.id, volunteerApplication.applicantUserId))
    .leftJoin(
      participantProfile,
      eq(participantProfile.id, volunteerApplication.participantProfileId)
    )
    .where(eq(volunteerApplication.id, applicationId));
  return row ?? null;
}

/**
 * The applicant: an adult on every channel, a teen in the inbox only (their
 * guardians are told by `volunteerGuardians`).
 */
export async function volunteerApplicant(
  db: AppDb,
  applicationId: string
): Promise<AudienceMember[]> {
  const facts = await applicationFacts(db, applicationId);
  if (!facts) return [];
  return facts.ownerKind === "guardian"
    ? [{ userId: facts.applicantUserId, channels: "in_app_only" }]
    : [facts.applicantUserId];
}

/** A teen applicant's verified guardians; nobody for an adult's. */
export async function volunteerGuardians(
  db: AppDb,
  applicationId: string
): Promise<AudienceMember[]> {
  const facts = await applicationFacts(db, applicationId);
  if (!facts?.profileId || facts.ownerKind !== "guardian") return [];
  const links = await guardianLinksByProfile(db, [facts.profileId]);
  return verifiedGuardianIds(links.get(facts.profileId) ?? []);
}

/** Everyone holding the community manager role everywhere. */
export async function communityManagers(db: AppDb): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: userRole.userId })
    .from(userRole)
    .where(
      and(
        eq(userRole.role, "community_manager"),
        eq(userRole.scopeType, "global"),
        isNull(userRole.scopeId)
      )
    )
    .orderBy(asc(userRole.userId));
  return rows.map((row) => row.userId);
}

/**
 * The applicant's name, and for a declined application why, read when the
 * message goes. Empty once the application is gone, which fails the
 * delivery rather than send a message with a hole in it.
 */
export async function applicationValues(
  db: AppDb,
  applicationId: string,
  cipher: FieldCipher
): Promise<Record<string, string>> {
  const facts = await applicationFacts(db, applicationId);
  if (!facts) return {};
  return {
    "applicant.name": facts.applicantName,
    ...(facts.declineReasonCiphertext === null
      ? {}
      : {
          "decline.reason": cipher.decrypt(
            DECLINE_REASON_PURPOSE,
            facts.declineReasonCiphertext
          ),
        }),
  };
}

/** Work alerts are generic inbox notices, resolved against current live facts.
 * Never send a note, rejection reason, task title or minor's details offsite. */
export async function volunteerWorkAudience(
  db: AppDb,
  fact:
    | { type: "assignment"; assignmentId: string }
    | { type: "hours"; entryId: string; status: "approved" | "rejected" },
  guardian: boolean
): Promise<AudienceMember[]> {
  const [row] =
    fact.type === "assignment"
      ? await db
          .select({ uid: volunteerTaskAssignment.volunteerUserId })
          .from(volunteerTaskAssignment)
          .innerJoin(
            volunteerTask,
            eq(volunteerTask.id, volunteerTaskAssignment.taskId)
          )
          .where(
            and(
              eq(volunteerTaskAssignment.id, fact.assignmentId),
              isNull(volunteerTaskAssignment.unassignedAt),
              inArray(volunteerTask.status, ["assigned", "in_progress", "done"])
            )
          )
      : await db
          .select({ uid: volunteerTaskAssignment.volunteerUserId })
          .from(volunteerHoursEntry)
          .innerJoin(
            volunteerTaskAssignment,
            eq(volunteerTaskAssignment.id, volunteerHoursEntry.assignmentId)
          )
          .where(
            and(
              eq(volunteerHoursEntry.id, fact.entryId),
              eq(volunteerHoursEntry.status, fact.status)
            )
          );
  if (!row) return [];
  if (!guardian) return [{ userId: row.uid, channels: "in_app_only" }];
  const [profile] = await db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(
      and(
        eq(participantProfile.loginUserId, row.uid),
        eq(participantProfile.ownerKind, "guardian")
      )
    );
  if (!profile) return [];
  const links = await guardianLinksByProfile(db, [profile.id]);
  return verifiedGuardianIds(links.get(profile.id) ?? []).map((userId) => ({
    userId,
    channels: "in_app_only",
  }));
}
