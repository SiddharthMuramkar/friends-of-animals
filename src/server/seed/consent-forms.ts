// Synthetic review states for local and preview databases. The scan rows
// are metadata only. Seeding stores no scan bytes and sends no notices.

import { eq } from "drizzle-orm";

import {
  consentEvent,
  consentForm,
  consentFormUpload,
  fileAsset,
  registration,
  user,
} from "../db/schema";
import { offeredFormPurposes } from "../modules/consent-forms/scope";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { SEED_ACCOUNTS } from "./accounts";
import { SEED_COORDINATORS } from "./coordinators";
import { seedFilesLocation } from "./files";
import { SEED_REGISTRATIONS, SEED_STUDENTS } from "./registration";
import type { Seeder } from "./types";

const FIXTURES = ["accepted", "pending_review", "rejected"] as const;

export const seedConsentForms: Seeder = async (deps) => {
  const { id: schoolRegistrationId, competitionId } =
    SEED_REGISTRATIONS.institution;
  const [coordinator] = await deps.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, SEED_COORDINATORS.coordinator.email));
  const [reviewer] = await deps.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, SEED_ACCOUNTS.superAdmin.email));
  const offer = (await offeredFormPurposes(deps.db, competitionId)).find(
    ({ purpose }) => purpose === "public_display"
  );
  if (!coordinator || !reviewer || !offer) return;
  const now = deps.clock.now();
  const { bucket, keyPrefix } = seedFilesLocation();
  const roster = await deps.db
    .select({
      id: registration.id,
      profileId: registration.participantProfileId,
    })
    .from(registration)
    .where(eq(registration.institutionRegistrationId, schoolRegistrationId));

  await deps.db.transaction(async (tx) => {
    for (const [index, status] of FIXTURES.entries()) {
      const student = roster.find(
        ({ id }) => id === SEED_STUDENTS[index]?.registrationId
      );
      if (!student) continue;
      const suffix = index + 1;
      const formId = `01938a00-0000-7000-8083-00000000000${suffix}`;
      const fileId = `01938a00-0000-7000-8083-00000000001${suffix}`;
      const reviewed = status !== "pending_review";
      await tx
        .insert(fileAsset)
        .values({
          id: fileId,
          ownerUserId: coordinator.id,
          purpose: "consent_form",
          contentType: "application/pdf",
          sizeBytes: 68,
          bucket,
          storageKey: storageKeyFor({
            prefix: keyPrefix,
            purpose: "consent_form",
            fileId,
          }),
          status: "clean",
          uploadedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      await tx
        .insert(consentFormUpload)
        .values({ fileAssetId: fileId, registrationId: student.id })
        .onConflictDoNothing();
      const [inserted] = await tx
        .insert(consentForm)
        .values({
          id: formId,
          participantProfileId: student.profileId,
          competitionId,
          institutionRegistrationId: schoolRegistrationId,
          fileAssetId: fileId,
          uses: [offer.purpose],
          documents: {
            public_display: { documentId: offer.id, version: offer.version },
          },
          status,
          uploadedByUserId: coordinator.id,
          submittedAt: now,
          reviewedByUserId: reviewed ? reviewer.id : null,
          reviewedAt: reviewed ? now : null,
          rejectionReason: status === "rejected" ? "not_signed" : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: consentForm.id });
      if (inserted && status === "accepted") {
        await tx.insert(consentEvent).values({
          id: "01938a00-0000-7000-8083-000000000021",
          subjectType: "participant_profile",
          subjectId: student.profileId,
          competitionId,
          purpose: offer.purpose,
          documentId: offer.id,
          action: "given",
          method: "paper_form",
          consentFormId: formId,
          reviewerUserId: reviewer.id,
          occurredAt: now,
        });
      }
    }
  });
};
