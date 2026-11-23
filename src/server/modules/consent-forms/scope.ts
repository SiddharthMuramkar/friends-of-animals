import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import {
  institutionRegistration,
  participantProfile,
  registration,
} from "../../db/schema";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import { competitionSetup } from "../consent/child-consent";
import { offeredPurposes } from "../consent/domain/guardian-purposes";
import { isPublicPurpose } from "../consent/domain/public-use";
import { childDateOfBirth } from "../guardians/child-view";
import { institutionResource } from "../institutions/coordinators/policy";
import { isAdultAt } from "../participants/domain/age";

export const targetInput = z.object({
  registrationId: z.uuid(),
  studentId: z.uuid(),
});

/** HR-32 and HR-33 keep paper collection dormant in production. */
export function consentFormsAvailable(ctx: Pick<UseCaseContext, "files">) {
  return ctx.files.appEnv !== "production";
}

type CoordinatorAction =
  | "consent_form.submit"
  | "consent_form.withdraw"
  | "consent_form.declare";

export async function authorizeSchool(
  ctx: UseCaseContext,
  db: AppDb,
  action: CoordinatorAction,
  registrationId: string
) {
  const [school] = await db
    .select()
    .from(institutionRegistration)
    .where(eq(institutionRegistration.id, registrationId));
  if (!school) throw new DomainError("forbidden", `May not ${action}`);
  const { role } = await authorize(
    { ...ctx, db },
    action,
    institutionResource(school.institutionId)
  );
  if (ctx.actor.kind !== "user")
    throw new Error("Expected a coordinator account");
  return { school, userId: ctx.actor.userId, role };
}

export function activeSchoolStudents(school: {
  id: string;
  competitionId: string;
  institutionId: string;
}) {
  return and(
    eq(registration.institutionRegistrationId, school.id),
    eq(registration.competitionId, school.competitionId),
    eq(registration.route, "institution"),
    inArray(registration.status, ["enrolled", "confirmed"]),
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
      createdAt: registration.createdAt,
      dobCiphertext: participantProfile.dobCiphertext,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(registration.participantProfileId, participantProfile.id)
    )
    .where(
      and(activeSchoolStudents(school), eq(participantProfile.id, studentId))
    );
  if (!row || isAdultAt(childDateOfBirth(ctx, row).date, row.createdAt))
    return null;
  return row;
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
