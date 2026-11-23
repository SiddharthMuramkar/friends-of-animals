import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { consentForm, participantProfile, registration } from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { childDateOfBirth } from "../guardians/child-view";
import { isAdultAt } from "../participants/domain/age";
import {
  activeSchoolStudents,
  authorizeSchool,
  consentFormsAvailable,
  offeredFormPurposes,
} from "./scope";

const registrationInput = z.object({ registrationId: z.uuid() });

export async function listSignedFormsForRegistration(
  ctx: UseCaseContext,
  input: z.input<typeof registrationInput>
) {
  const parsed = registrationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId } = parsed.data;
  const { school } = await authorizeSchool(
    ctx,
    ctx.db,
    "consent_form.submit",
    registrationId
  );
  if (!consentFormsAvailable(ctx))
    return { ok: false, error: "unavailable" } as const;
  const [students, forms, offers] = await Promise.all([
    ctx.db
      .select({
        studentId: participantProfile.id,
        enrolmentId: registration.id,
        dobCiphertext: participantProfile.dobCiphertext,
        createdAt: registration.createdAt,
      })
      .from(registration)
      .innerJoin(
        participantProfile,
        eq(participantProfile.id, registration.participantProfileId)
      )
      .where(activeSchoolStudents(school)),
    ctx.db
      .selectDistinctOn([consentForm.participantProfileId], {
        studentId: consentForm.participantProfileId,
        id: consentForm.id,
        status: consentForm.status,
        rejectionReason: consentForm.rejectionReason,
        rejectionNote: consentForm.rejectionNote,
      })
      .from(consentForm)
      .where(eq(consentForm.institutionRegistrationId, registrationId))
      .orderBy(
        consentForm.participantProfileId,
        desc(consentForm.submittedAt),
        desc(consentForm.id)
      ),
    offeredFormPurposes(ctx.db, school.competitionId),
  ]);
  const byStudent = new Map(
    forms.map(({ studentId, ...form }) => [studentId, form])
  );
  return {
    ok: true,
    offers,
    participationDeclaredAt: school.participationDeclaredAt,
    students: students
      .filter(
        (student) =>
          !isAdultAt(childDateOfBirth(ctx, student).date, student.createdAt)
      )
      .map(({ studentId, enrolmentId }) => ({
        studentId,
        enrolmentId,
        form: byStudent.get(studentId) ?? null,
      })),
  } as const;
}

export type SignedFormsForRegistration = Extract<
  Awaited<ReturnType<typeof listSignedFormsForRegistration>>,
  { ok: true }
>;
