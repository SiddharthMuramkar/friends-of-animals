import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  consentForm,
  consentFormUpload,
  participantProfile,
  registration,
} from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { childDateOfBirth } from "../guardians/child-view";
import { isAdultAt } from "../participants/domain/age";
import {
  authorizeSchool,
  consentFormsAvailable,
  offeredFormPurposes,
  schoolStudents,
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
        status: registration.status,
        dobCiphertext: participantProfile.dobCiphertext,
        createdAt: registration.createdAt,
      })
      .from(registration)
      .innerJoin(
        participantProfile,
        eq(participantProfile.id, registration.participantProfileId)
      )
      .where(schoolStudents(school)),
    ctx.db
      .selectDistinctOn([consentFormUpload.registrationId], {
        enrolmentId: consentFormUpload.registrationId,
        id: consentForm.id,
        status: consentForm.status,
        rejectionReason: consentForm.rejectionReason,
        rejectionNote: consentForm.rejectionNote,
      })
      .from(consentForm)
      .innerJoin(
        consentFormUpload,
        eq(consentFormUpload.fileAssetId, consentForm.fileAssetId)
      )
      .where(eq(consentForm.institutionRegistrationId, registrationId))
      .orderBy(
        consentFormUpload.registrationId,
        desc(consentForm.submittedAt),
        desc(consentForm.id)
      ),
    offeredFormPurposes(ctx.db, school.competitionId),
  ]);
  const byEnrolment = new Map(
    forms.map(({ enrolmentId, ...form }) => [enrolmentId, form])
  );
  return {
    ok: true,
    offers,
    participationDeclaredAt: school.participationDeclaredAt,
    students: students.flatMap((student) => {
      const { studentId, enrolmentId, status, createdAt } = student;
      const form = byEnrolment.get(enrolmentId) ?? null;
      const uploadEligible =
        school.status === "active" &&
        (status === "enrolled" || status === "confirmed") &&
        !isAdultAt(childDateOfBirth(ctx, student).date, createdAt);
      return uploadEligible || form !== null
        ? [{ studentId, enrolmentId, uploadEligible, form }]
        : [];
    }),
  } as const;
}

export type SignedFormsForRegistration = Extract<
  Awaited<ReturnType<typeof listSignedFormsForRegistration>>,
  { ok: true }
>;
