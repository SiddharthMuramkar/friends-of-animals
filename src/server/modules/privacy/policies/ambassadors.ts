import { eq, sql } from "drizzle-orm";
import { ambassadorApplication, participantProfile } from "../../../db/schema";
import { rowPolicy } from "./define";

// A declined application expires after the configured period; pending and
// approved records remain until decided or subject erasure. Legal holds
// cover the actual person's profile and login, but not their guardian.
export const AMBASSADOR_APPLICATIONS = rowPolicy({
  key: "ambassadorApplications",
  table: ambassadorApplication,
  action: "delete",
  period: "ambassadorApplications",
  anchor: ambassadorApplication.decidedAt,
  where: eq(ambassadorApplication.status, "declined"),
  subjects: [
    ["user", ambassadorApplication.applicantUserId],
    ["user", ambassadorApplication.decidedByUserId],
    [
      "participant_profile",
      sql`(SELECT ${participantProfile.id} FROM ${participantProfile} WHERE ${participantProfile.loginUserId}=${ambassadorApplication.applicantUserId})`,
    ],
    [
      "participant_profile",
      sql`(SELECT ${participantProfile.id} FROM ${participantProfile} WHERE ${participantProfile.ownerKind}='self' AND ${participantProfile.ownerUserId}=${ambassadorApplication.applicantUserId})`,
    ],
  ],
});
