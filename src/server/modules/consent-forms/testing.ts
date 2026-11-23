import { eq } from "drizzle-orm";

import { competitionConsentDocument, registration } from "@/server/db/schema";
import {
  ALL_GUARDIAN_DOCUMENTS,
  publishNextVersion,
} from "@/server/modules/consent/testing";
import { AANYA, registeredSchool } from "@/server/modules/registration/testing";
import { createHarness, type Harness } from "@/test/harness";

export const SCAN = new TextEncoder().encode("Synthetic signed-form fixture");
export const UPLOAD = {
  contentType: "application/pdf",
  sizeBytes: SCAN.length,
};

export async function formWorld() {
  const h = await createHarness();
  const school = await registeredSchool(h, {
    competition: {
      publicDisplay: true,
      auctionPermitted: true,
    },
  });
  for (const purpose of ALL_GUARDIAN_DOCUMENTS) {
    const document = await publishNextVersion(h, purpose);
    await h.db.insert(competitionConsentDocument).values({
      competitionId: school.competition.id,
      purpose,
      consentDocumentId: document.id,
      attachedAt: h.clock.now(),
    });
  }
  const coordinator = h.as(school.coordinator.actor);
  const enrolled = await coordinator.enrolStudent({
    institutionId: school.institutionId,
    reference: school.reference,
    student: AANYA,
  });
  if (!enrolled.ok) throw new Error(`Enrolment refused: ${enrolled.error}`);
  const [student] = await h.db
    .select({ studentId: registration.participantProfileId })
    .from(registration)
    .where(eq(registration.id, enrolled.registrationId));
  const formScope = {
    institutionId: school.institutionId,
    registrationId: school.registrationId,
  };
  const target = {
    ...formScope,
    studentId: student!.studentId,
  };
  return { h, school, coordinator, formScope, target };
}

export type FormWorld = Awaited<ReturnType<typeof formWorld>>;

export async function uploadScan({ coordinator, h, target }: FormWorld) {
  const upload = await coordinator.requestConsentFormUpload({
    ...target,
    ...UPLOAD,
  });
  if (!upload.ok) throw new Error(`Upload refused: ${upload.error}`);
  await h.storage.put(upload.uploadUrl, SCAN, upload.headers);
  const completed = await coordinator.completeUpload({ fileId: upload.fileId });
  if (!completed.ok) throw new Error(`Completion refused: ${completed.error}`);
  return upload.fileId;
}

export async function submitScan(
  w: FormWorld,
  uses = ["public_display", "auction"]
) {
  const fileId = await uploadScan(w);
  const submitted = await w.coordinator.submitConsentForm({
    ...w.target,
    fileId,
    uses,
  });
  if (!submitted.ok) throw new Error(`Submission refused: ${submitted.error}`);
  return { formId: submitted.formId, fileId };
}

export async function signInReviewer(h: Harness, secondFactor = true) {
  const reviewer = await h.seed.member({ name: "Synthetic Reviewer" });
  await h.seed.grant(reviewer, {
    role: "staff_admin",
    scope: { type: "global" },
  });
  return {
    userId: reviewer.id,
    actor: await h.signIn(reviewer, {}, { secondFactor }),
  };
}
