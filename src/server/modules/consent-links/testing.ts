// These fixtures use the landed school enrolment and consent tables.
import { eq } from "drizzle-orm";

import { competitionConsentDocument, registration } from "@/server/db/schema";
import { publishNextVersion } from "@/server/modules/consent/testing";
import { AANYA, registeredSchool } from "@/server/modules/registration/testing";
import { seedConsentLinkTemplates } from "@/server/seed/consent-link-templates";
import type { Harness } from "@/test/harness";

export const COMPETITION_TITLE = "Synthetic Art Competition";
export const GUARDIAN_EMAIL = "guardian.link@example.test";

export async function consentLinkWorld(
  h: Harness,
  { offers = true }: { offers?: boolean } = {}
) {
  const school = await registeredSchool(h, {
    competition: { name: COMPETITION_TITLE, publicDisplay: offers },
  });
  await seedConsentLinkTemplates(h.deps);
  const coordinator = h.as(school.coordinator.actor);
  const student = await coordinator.enrolStudent({
    institutionId: school.institutionId,
    reference: school.reference,
    student: AANYA,
  });
  if (!student.ok) throw new Error("Could not enrol the synthetic student");
  const [entry] = await h.db
    .select()
    .from(registration)
    .where(eq(registration.id, student.registrationId));
  if (!entry) throw new Error("The synthetic enrolment is missing");

  const documents = {} as Record<
    "public_display" | "social_media",
    {
      id: string;
      version: number;
    }
  >;
  if (offers) {
    for (const purpose of ["public_display", "social_media"] as const) {
      const document = await publishNextVersion(h, purpose);
      documents[purpose] = document;
      await h.db.insert(competitionConsentDocument).values({
        competitionId: school.competition.id,
        purpose,
        consentDocumentId: document.id,
        attachedAt: h.clock.now(),
      });
    }
  }

  return {
    ...school,
    documents,
    coordinator,
    studentId: entry.participantProfileId,
    send: {
      institutionId: school.institutionId,
      registrationId: school.registrationId,
      studentId: entry.participantProfileId,
      channel: "email" as const,
      address: GUARDIAN_EMAIL,
    },
  };
}

export function deliveredToken(h: Harness, address = GUARDIAN_EMAIL): string {
  const token = /\/consent\/([\w-]{43})(?![\w-])/.exec(
    h.email.lastTo(address)?.text ?? ""
  )?.[1];
  if (!token) throw new Error("The synthetic mailbox has no consent link");
  return token;
}
