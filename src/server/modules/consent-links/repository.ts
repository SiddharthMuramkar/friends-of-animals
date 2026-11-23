import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  competition,
  consentLink,
  institution,
  institutionRegistration,
  participantProfile,
  registration,
  type ConsentLink,
} from "../../db/schema";

export const LINK_CONTACT = "consent_link.contact";
export const LINK_TOKEN = "consent_link.token";

export function consentLinksActive(appEnv: string): boolean {
  // HR-32/33: only capture environments can run the flow pending approval.
  return appEnv === "local" || appEnv === "preview";
}

export async function schoolRegistration(
  db: AppDb,
  key: ({ id: string } | { reference: string }) & { institutionId?: string }
) {
  const [row] = await db
    .select({
      id: institutionRegistration.id,
      reference: institutionRegistration.reference,
      institutionId: institution.id,
      institutionName: institution.name,
      schoolStatus: institution.status,
      status: institutionRegistration.status,
      competition: {
        id: competition.id,
        name: competition.name,
        publicDisplay: competition.publicDisplay,
        auctionPermitted: competition.auctionPermitted,
      },
    })
    .from(institutionRegistration)
    .innerJoin(
      institution,
      eq(institutionRegistration.institutionId, institution.id)
    )
    .innerJoin(
      competition,
      eq(institutionRegistration.competitionId, competition.id)
    )
    .where(
      and(
        "id" in key
          ? eq(institutionRegistration.id, key.id)
          : eq(institutionRegistration.reference, key.reference),
        key.institutionId
          ? eq(institutionRegistration.institutionId, key.institutionId)
          : undefined
      )
    );
  return row;
}

const studentColumns = {
  registrationId: registration.id,
  studentId: participantProfile.id,
  name: participantProfile.fullName,
  guardianEmail: participantProfile.guardianEmailCiphertext,
  guardianPhone: participantProfile.guardianPhoneCiphertext,
};

export type SchoolRegistration = NonNullable<
  Awaited<ReturnType<typeof schoolRegistration>>
>;

export function schoolStudents(
  db: AppDb,
  school: SchoolRegistration,
  student?: { profileId: string; registrationId?: string; lock?: boolean }
) {
  const query = db
    .select(studentColumns)
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(registration.participantProfileId, participantProfile.id)
    )
    .where(
      and(
        eq(registration.institutionRegistrationId, school.id),
        eq(registration.competitionId, school.competition.id),
        eq(registration.route, "institution"),
        inArray(registration.status, ["enrolled", "confirmed"]),
        eq(participantProfile.ownerKind, "institution"),
        eq(participantProfile.managingInstitutionId, school.institutionId),
        student && eq(participantProfile.id, student.profileId),
        student?.registrationId
          ? eq(registration.id, student.registrationId)
          : undefined
      )
    )
    .orderBy(asc(participantProfile.fullName), asc(registration.id));
  return student?.lock ? query.for("share", { of: registration }) : query;
}

export async function activeLinkTarget(
  db: AppDb,
  link: ConsentLink,
  lock = false
) {
  const school = await schoolRegistration(db, {
    id: link.institutionRegistrationId,
  });
  if (
    !school ||
    school.status !== "active" ||
    school.schoolStatus !== "verified"
  )
    return null;
  const [student] = await schoolStudents(db, school, {
    profileId: link.participantProfileId,
    registrationId: link.studentRegistrationId,
    lock,
  });
  return student ? { school, student } : null;
}

export async function findLink(db: AppDb, tokenHash: string, lock = false) {
  const query = db
    .select()
    .from(consentLink)
    .where(eq(consentLink.tokenHash, tokenHash));
  const [row] = lock ? await query.for("update") : await query;
  return row;
}

export function linksForRegistration(db: AppDb, registrationId: string) {
  return db
    .selectDistinctOn([consentLink.studentRegistrationId], {
      id: consentLink.id,
      studentRegistrationId: consentLink.studentRegistrationId,
      status: consentLink.status,
      expiresAt: consentLink.expiresAt,
      codesSent: consentLink.codesSent,
      verifiedAt: consentLink.verifiedAt,
    })
    .from(consentLink)
    .where(eq(consentLink.institutionRegistrationId, registrationId))
    .orderBy(consentLink.studentRegistrationId, desc(consentLink.id));
}

/** Clear secrets together when a pending link is closed. */
export const CLOSED_LINK_SECRETS = {
  tokenCiphertext: null,
  codeHash: null,
  codeExpiresAt: null,
  sessionTokenHash: null,
} as const;
