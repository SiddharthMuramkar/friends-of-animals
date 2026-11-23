import { z } from "zod";

import { authorize } from "../../access/can";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { latestProfileConsents } from "../consent/repository";
import { institutionResource } from "../institutions/coordinators/policy";
import { parseInstitutionRegistrationReference } from "../registration/domain/institution-registration-reference";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import { linkStatus } from "./domain/link";
import { studentConsentStatus } from "./domain/student-status";
import { offeredPublicUses } from "./offered-uses";
import {
  consentLinksActive,
  linksForRegistration,
  schoolRegistration,
  schoolStudents,
} from "./repository";

const listInput = z.union([
  z.object({ registrationId: z.uuid(), contactFor: z.uuid().optional() }),
  z.object({ reference: z.string().max(40), contactFor: z.uuid().optional() }),
]);

export type ListStudentConsentsInput = z.input<typeof listInput>;

export async function listStudentConsents(
  ctx: UseCaseContext,
  input: ListStudentConsentsInput
) {
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { contactFor } = parsed.data;
  const key =
    "registrationId" in parsed.data
      ? { id: parsed.data.registrationId }
      : parseInstitutionRegistrationReference(parsed.data.reference);
  if (!key) return { ok: false, error: "not_found" } as const;
  const school = await schoolRegistration(ctx.db, key);
  if (!school) return { ok: false, error: "not_found" } as const;
  await authorize(
    ctx,
    "consent_link.list",
    institutionResource(school.institutionId)
  );
  if (!consentLinksActive(ctx.appEnv))
    return { ok: false, error: "unavailable" } as const;
  if (school.status !== "active" || school.schoolStatus !== "verified") {
    return { ok: false, error: "not_found" } as const;
  }

  const now = ctx.clock.now();
  const [students, links, offers, smsEnabled] = await Promise.all([
    schoolStudents(ctx.db, school),
    linksForRegistration(ctx.db, school.id),
    offeredPublicUses(ctx.db, school.competition),
    ctx.settings.get("sms.enabled"),
  ]);
  const linkByEntry = new Map(
    links.map((link) => [link.studentRegistrationId, link])
  );
  const current = await latestProfileConsents(
    ctx.db,
    students.map(({ studentId }) => studentId),
    school.competition.id
  );
  const byStudent = Map.groupBy(current, (consent) => consent.subjectId);
  const contact = contactFor
    ? students.find((student) => student.studentId === contactFor)
    : undefined;
  // A contact is decrypted only for the student whose send form is open.
  const suggestedContact = contact
    ? {
        email: contact.guardianEmail
          ? ctx.cipher.decrypt(
              PROFILE_PURPOSE.guardianEmail,
              contact.guardianEmail
            )
          : null,
        sms:
          smsEnabled && contact.guardianPhone
            ? ctx.cipher.decrypt(
                PROFILE_PURPOSE.guardianPhone,
                contact.guardianPhone
              )
            : null,
      }
    : null;

  return {
    ok: true,
    registrationId: school.id,
    reference: school.reference,
    institutionId: school.institutionId,
    institutionName: school.institutionName,
    competitionTitle: school.competition.name,
    hasOffers: offers.length > 0,
    smsEnabled,
    suggestedContact,
    students: students.map(({ studentId, name, registrationId }) => {
      const latest = linkByEntry.get(registrationId);
      const active = byStudent.get(studentId) ?? [];
      const status = studentConsentStatus(
        latest ? linkStatus(latest, now) : null,
        offers.map(({ purpose, documentId }) => {
          const consent = active.find(
            (given) =>
              given.purpose === purpose && given.documentId === documentId
          );
          return { purpose, status: consent?.action ?? "never" };
        })
      );
      return {
        ...status,
        name,
        studentId,
        canSendLink: status.canSendLink && offers.length > 0,
        revocableLinkId: latest?.status === "pending" ? latest.id : null,
      };
    }),
  } as const;
}

export type StudentConsents = Extract<
  Awaited<ReturnType<typeof listStudentConsents>>,
  { ok: true }
>;
