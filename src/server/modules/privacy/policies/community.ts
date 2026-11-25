import { eq, sql } from "drizzle-orm";
import { communityMember, participantProfile } from "../../../db/schema";
import { rowPolicy } from "./define";

// The identifying text expires; the participation history remains until
// erasure. Hold both a login and its linked profile's membership records.
export const COMMUNITY_MEMBERS = rowPolicy({
  key: "communityMembers",
  table: communityMember,
  action: "anonymise",
  period: "communityMembers",
  anchor: communityMember.leftAt,
  where: eq(communityMember.status, "left"),
  subjects: [
    ["user", communityMember.subjectUserId],
    ["participant_profile", communityMember.subjectProfileId],
    [
      "user",
      sql`(SELECT coalesce(${participantProfile.loginUserId},CASE WHEN ${participantProfile.ownerKind}='self' THEN ${participantProfile.ownerUserId} END) FROM ${participantProfile} WHERE ${participantProfile.id}=${communityMember.subjectProfileId})`,
    ],
    [
      "participant_profile",
      sql`(SELECT ${participantProfile.id} FROM ${participantProfile} WHERE ${participantProfile.loginUserId}=${communityMember.subjectUserId} OR (${participantProfile.ownerKind}='self' AND ${participantProfile.ownerUserId}=${communityMember.subjectUserId}) LIMIT 1)`,
    ],
  ],
});
