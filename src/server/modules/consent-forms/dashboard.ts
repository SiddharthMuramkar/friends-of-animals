import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";

import {
  consentForm,
  consentFormUpload,
  participantProfile,
  registration,
} from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { schoolPublicConsents } from "../consent/school-route-use";
import {
  authorizeSchool,
  canCollectSchoolConsent,
  consentFormsAvailable,
  isEnrolledMinor,
  offeredFormPurposes,
  schoolScopeInput,
  schoolStudents,
} from "./scope";

export async function listSignedFormsForRegistration(
  ctx: UseCaseContext,
  input: z.input<typeof schoolScopeInput>
) {
  const parsed = schoolScopeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId } = parsed.data;
  const { school } = await authorizeSchool(
    ctx,
    ctx.db,
    "consent_form.submit",
    parsed.data
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
        studentId: consentForm.participantProfileId,
        form: {
          id: consentForm.id,
          status: consentForm.status,
          rejectionReason: consentForm.rejectionReason,
          rejectionNote: consentForm.rejectionNote,
        },
      })
      .from(consentForm)
      .innerJoin(
        consentFormUpload,
        eq(consentFormUpload.fileAssetId, consentForm.fileAssetId)
      )
      .where(
        and(
          eq(consentForm.institutionRegistrationId, registrationId),
          eq(consentForm.competitionId, school.competitionId)
        )
      )
      .orderBy(
        consentFormUpload.registrationId,
        // A pending form blocks its replacement, including submissions at the same instant.
        desc(eq(consentForm.status, "pending_review")),
        desc(consentForm.submittedAt),
        desc(consentForm.id)
      ),
    offeredFormPurposes(ctx.db, school.competitionId),
  ]);
  const byEnrolment = new Map(
    forms.map(({ enrolmentId, form }) => [enrolmentId, form])
  );
  const pendingByStudent = new Map(
    forms
      .filter(({ form }) => form.status === "pending_review")
      .map(({ studentId, form }) => [studentId, form])
  );
  const roster = students.map((student) => ({
    ...student,
    enrolledMinor: isEnrolledMinor(ctx, student),
  }));
  const activeStudents = new Set(
    roster
      .filter(({ enrolledMinor }) => enrolledMinor)
      .map(({ studentId }) => studentId)
  );
  const consent = await schoolPublicConsents(ctx.db, {
    profileIds: [...activeStudents],
    competitionId: school.competitionId,
    offers,
  });
  const canCollect = canCollectSchoolConsent(school);
  return {
    ok: true,
    offers,
    canDeclareParticipation:
      canCollect && school.participationDeclaredAt === null,
    participationDeclaredAt: school.participationDeclaredAt,
    students: roster.flatMap(({ studentId, enrolmentId, enrolledMinor }) => {
      const historicalForm = byEnrolment.get(enrolmentId) ?? null;
      const form = enrolledMinor
        ? (pendingByStudent.get(studentId) ?? historicalForm)
        : historicalForm;
      if (!enrolledMinor && !form) return [];
      const pending = form?.status === "pending_review";
      return [
        {
          studentId,
          enrolmentId,
          uploadEligible: canCollect && enrolledMinor && !pending,
          canWithdraw:
            pending && (enrolledMinor || !activeStudents.has(studentId)),
          form,
          effectiveConsent: enrolledMinor ? (consent.get(studentId) ?? []) : [],
        },
      ];
    }),
  } as const;
}

export type SignedFormsForRegistration = Extract<
  Awaited<ReturnType<typeof listSignedFormsForRegistration>>,
  { ok: true }
>;
