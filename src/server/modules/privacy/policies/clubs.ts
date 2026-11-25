import { inArray, sql } from "drizzle-orm";
import {
  club,
  clubDecision,
  clubMembership,
  participantProfile,
} from "../../../db/schema";
import { instant, rowPolicy } from "./define";
const terminal = ["declined", "withdrawn", "closed"] as const;
const clubAnchor = instant(
  sql`(select ${club.updatedAt} from ${club} where ${club.id}=${clubDecision.clubId})`,
  club.updatedAt
);
const applicant = sql`(select ${club.applicantUserId} from ${club} where ${club.id}=${clubDecision.clubId})`;
const profile = (
  user:
    | typeof clubMembership.userId
    | typeof club.applicantUserId
    | ReturnType<typeof sql>
) =>
  sql`(select ${participantProfile.id} from ${participantProfile} where ${participantProfile.loginUserId}=${user} or (${participantProfile.ownerKind}='self' and ${participantProfile.ownerUserId}=${user}) limit 1)`;
export const CLUB_MEMBERSHIPS = rowPolicy({
  key: "clubMemberships",
  table: clubMembership,
  action: "delete",
  period: "clubMemberships",
  anchor: clubMembership.leftAt,
  subjects: [
    ["user", clubMembership.userId],
    ["participant_profile", profile(clubMembership.userId)],
    [
      "institution",
      sql`(select ${club.institutionId} from ${club} where ${club.id}=${clubMembership.clubId})`,
    ],
  ],
});
// Decision text is anonymised before the applicant link, so a hold on a
// teen's profile stops both policies from discarding their evidence.
export const CLUB_DECISIONS = rowPolicy({
  key: "clubDecisions",
  table: clubDecision,
  action: "anonymise",
  period: "clubApplications",
  anchor: clubAnchor,
  where: sql`exists(select 1 from ${club} where ${club.id}=${clubDecision.clubId} and ${inArray(club.status, [...terminal])})`,
  subjects: [
    ["user", applicant],
    ["participant_profile", profile(applicant)],
    ["user", clubDecision.decidedByUserId],
    [
      "institution",
      sql`(select ${club.institutionId} from ${club} where ${club.id}=${clubDecision.clubId})`,
    ],
  ],
});
export const CLUB_APPLICATIONS = rowPolicy({
  key: "clubApplications",
  table: club,
  action: "anonymise",
  period: "clubApplications",
  anchor: club.updatedAt,
  where: inArray(club.status, [...terminal]),
  subjects: [
    ["user", club.applicantUserId],
    ["participant_profile", profile(club.applicantUserId)],
    ["institution", club.institutionId],
  ],
});
