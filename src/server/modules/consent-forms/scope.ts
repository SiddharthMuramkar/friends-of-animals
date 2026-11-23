import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import {
  institutionRegistration,
  institution,
  participantProfile,
  registration,
} from "../../db/schema";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import { competitionSetup } from "../consent/child-consent";
import { offeredPurposes } from "../consent/domain/guardian-purposes";
import { isPublicPurpose } from "../consent/domain/public-use";
import { isFilePurposeAvailable } from "../files/domain/purposes";
import { childDateOfBirth } from "../guardians/child-view";
import { institutionResource } from "../institutions/coordinators/policy";
import { isAdultAt } from "../participants/domain/age";

export const schoolScopeInput = z.object({
  institutionId: z.uuid(),
  registrationId: z.uuid(),
});

export const targetInput = schoolScopeInput.extend({
  studentId: z.uuid(),
});

/** HR-32 and HR-33 keep paper collection dormant in production. */
export function consentFormsAvailable(ctx: Pick<UseCaseContext, "files">) {
  return isFilePurposeAvailable("consent_form", ctx.files.appEnv);
}

type CoordinatorAction =
  | "consent_form.submit"
  | "consent_form.withdraw"
  | "consent_form.declare";

export async function authorizeSchool(
  ctx: UseCaseContext,
  db: AppDb,
  action: CoordinatorAction,
  { institutionId, registrationId }: z.infer<typeof schoolScopeInput>,
  { lock = false }: { lock?: boolean } = {}
) {
  const { role } = await authorize(
    { ...ctx, db },
    action,
    institutionResource(institutionId)
  );
  const query = db
    .select({
      id: institutionRegistration.id,
      institutionId: institutionRegistration.institutionId,
      competitionId: institutionRegistration.competitionId,
      status: institutionRegistration.status,
      institutionStatus: institution.status,
      participationDeclaredAt: institutionRegistration.participationDeclaredAt,
    })
    .from(institutionRegistration)
    .innerJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .where(
      and(
        eq(institutionRegistration.id, registrationId),
        eq(institutionRegistration.institutionId, institutionId)
      )
    );
  // Keep a suspension or roster change from overtaking a collection write.
  const [school] = lock
    ? await query.for(
        action === "consent_form.declare" ? "no key update" : "share"
      )
    : await query;
  if (!school) throw new DomainError("forbidden", `May not ${action}`);
  if (ctx.actor.kind !== "user")
    throw new Error("Expected a coordinator account");
  return { school, userId: ctx.actor.userId, role };
}

export function canCollectSchoolConsent(school: {
  status: string;
  institutionStatus: string;
}) {
  return school.status === "active" && school.institutionStatus === "verified";
}

const CURRENT_ENROLMENTS = ["enrolled", "confirmed"] as const;

export function isEnrolledMinor(
  ctx: Pick<UseCaseContext, "cipher">,
  student: {
    status: typeof registration.$inferSelect.status;
    dobCiphertext: string;
    createdAt: Date;
  }
) {
  return (
    CURRENT_ENROLMENTS.some((status) => status === student.status) &&
    !isAdultAt(childDateOfBirth(ctx, student).date, student.createdAt)
  );
}

export function schoolStudents(school: {
  id: string;
  competitionId: string;
  institutionId: string;
}) {
  return and(
    eq(registration.institutionRegistrationId, school.id),
    eq(registration.competitionId, school.competitionId),
    eq(registration.route, "institution"),
    eq(participantProfile.ownerKind, "institution"),
    eq(participantProfile.managingInstitutionId, school.institutionId)
  );
}

export async function schoolStudent(
  ctx: Pick<UseCaseContext, "cipher">,
  db: AppDb,
  school: {
    id: string;
    competitionId: string;
    institutionId: string;
    status: string;
  },
  studentId: string
) {
  if (school.status !== "active") return null;
  const [row] = await db
    .select({
      id: registration.id,
      status: registration.status,
      createdAt: registration.createdAt,
      dobCiphertext: participantProfile.dobCiphertext,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(registration.participantProfileId, participantProfile.id)
    )
    .where(
      and(
        schoolStudents(school),
        inArray(registration.status, CURRENT_ENROLMENTS),
        eq(participantProfile.id, studentId)
      )
    );
  return row && isEnrolledMinor(ctx, row) ? row : null;
}

/** The purposes and exact versions the competition offers a school-route guardian. */
export async function offeredFormPurposes(db: AppDb, competitionId: string) {
  const found = await competitionSetup(db, competitionId);
  if (!found) return [];
  return offeredPurposes(found.setup).flatMap(({ purpose, document }) => {
    if (!isPublicPurpose(purpose)) return [];
    const published = found.documents.find(({ id }) => id === document.id);
    return published ? [{ purpose, ...published }] : [];
  });
}
