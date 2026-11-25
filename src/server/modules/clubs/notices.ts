import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { club, clubDecision, participantProfile } from "../../db/schema";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { AudienceMember } from "../notifications/domain/audience-member";
import { guardianLinksByProfile } from "../guardians/participant-audience";
import { minorAudience } from "../guardians/domain/minor-audience";
import { CLUB_REASON_PURPOSE } from "./decisions";

export const CLUB_NOTICE_VARIABLES = [
  "club.name",
  "club.outcome",
  "club.reason",
] as const;
async function decision(db: AppDb, id: string) {
  const [row] = await db
    .select({
      name: club.name,
      applicant: club.applicantUserId,
      kind: club.applicantKind,
      verified: club.applicantVerified,
      from: clubDecision.fromStatus,
      to: clubDecision.toStatus,
      reason: clubDecision.reasonCiphertext,
    })
    .from(clubDecision)
    .innerJoin(club, eq(club.id, clubDecision.clubId))
    .where(eq(clubDecision.id, id));
  return row;
}
export async function clubNoticeRecipients(
  db: AppDb,
  id: string
): Promise<AudienceMember[]> {
  const row = await decision(db, id);
  if (!row?.applicant) return [];
  const [teen] = await db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(eq(participantProfile.loginUserId, row.applicant));
  if (teen) {
    const links = await guardianLinksByProfile(db, [teen.id]);
    const plan = minorAudience({
      minor: true,
      loginUserId: row.applicant,
      guardians: links.get(teen.id) ?? [],
    });
    if (plan.kind === "suppress")
      return [{ userId: row.applicant, suppressed: "no_guardian" }];
    return plan.recipients.map((r) =>
      r.channels === "all"
        ? r.userId
        : { userId: r.userId, channels: "in_app_only" }
    );
  }
  // A verified teacher's scoped institutional grant is an adult service
  // contact. Unknown-age/student prospects only receive an inbox copy.
  return row.verified && row.kind === "teacher"
    ? [row.applicant]
    : [{ userId: row.applicant, channels: "in_app_only" }];
}
export async function clubNoticeValues(
  db: AppDb,
  id: string,
  cipher: FieldCipher
): Promise<Record<string, string>> {
  const row = await decision(db, id);
  if (!row) return {};
  return {
    "club.name": row.name,
    "club.outcome":
      row.from === "suspended" && row.to === "approved" ? "reinstated" : row.to,
    "club.reason": row.reason
      ? cipher.decrypt(CLUB_REASON_PURPOSE, row.reason)
      : "—",
  };
}
