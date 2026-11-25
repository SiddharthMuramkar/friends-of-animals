// Adoption application seed data (#130), so a preview can demo the whole
// workflow: an adoption coordinator with the seed authenticator, an
// application waiting for review on Seed Bruno, one in contact with the
// NGO on Seed Rani, and the adoption of Seed Moti with its published
// success story. Each applicant gave the contact-sharing consent (and
// Moti's adopter the story consent) on version 1, which the consent seed
// publishes. Runs after the adoption and consent seeds. Seed data sends
// nothing and writes no audit entry. Idempotent: rows already there are
// left alone.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq } from "drizzle-orm";

import { adoptionApplication, adoptionStory, consentEvent } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { uuidv7 } from "../ids";
import type { AdoptionAnswers } from "../modules/adoption/domain/application-input";
import type { AdoptionApplicationStatus } from "../modules/adoption/domain/application-status";
import { APPLICATION_PURPOSE } from "../modules/adoption/applications/record";
import type { AdoptionPurpose } from "../modules/consent/domain/purposes";
import { latestDocument } from "../modules/consent/repository";
import { formatIsoDate } from "../modules/registration/domain/calendar-date";
import { ensureGrant } from "./access";
import { SEED_ADOPTION } from "./adoption";
import { bornYearsAgo } from "./guardians";
import { ensureSeedAuthenticator } from "./second-factor";
import type { SeedDeps } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export const SEED_ADOPTION_APPLICATIONS = {
  coordinator: {
    name: "Ravi Menon",
    email: "adoption-coordinator@example.test",
  },
  submitted: {
    name: "Kiran Joshi",
    email: "adopter1@example.test",
    applicationId: "01938a00-0000-7000-8000-000000013001",
  },
  inContact: {
    name: "Farah Khan",
    email: "adopter2@example.test",
    applicationId: "01938a00-0000-7000-8000-000000013002",
  },
  adopted: {
    name: "Leela Pillai",
    email: "adopter3@example.test",
    applicationId: "01938a00-0000-7000-8000-000000013003",
    storyId: "01938a00-0000-7000-8000-000000013004",
  },
} as const;

const ANSWERS: AdoptionAnswers = {
  homeType: "house",
  hasOutdoorSpace: true,
  otherAnimals: "One older cat.",
  experience: "We have looked after rescued cats for ten years.",
  whyThisAnimal: "A calm companion for our older cat and a quiet home.",
};

const STORY =
  "Moti spent her first week under the bed. Now she naps in the sun by the window and follows us from room to room. Thank you for bringing us together.";

/** The user's consent to `purpose` on `documentId`: the event there, or a new one. */
async function ensureConsent(
  deps: SeedDeps,
  userId: string,
  purpose: AdoptionPurpose,
  documentId: string
): Promise<string> {
  const [given] = await deps.db
    .select({ id: consentEvent.id })
    .from(consentEvent)
    .where(
      and(
        eq(consentEvent.subjectType, "user"),
        eq(consentEvent.subjectId, userId),
        eq(consentEvent.purpose, purpose),
        eq(consentEvent.documentId, documentId),
        eq(consentEvent.action, "given")
      )
    )
    .limit(1);
  if (given) return given.id;
  const now = deps.clock.now();
  const id = uuidv7(now);
  await deps.db.insert(consentEvent).values({
    id,
    subjectType: "user",
    subjectId: userId,
    giverUserId: userId,
    purpose,
    documentId,
    action: "given",
    method: "web_form",
    occurredAt: now,
  });
  return id;
}

async function ensureApplication(
  deps: SeedDeps,
  input: {
    id: string;
    listingId: string;
    applicantUserId: string;
    consentId: string;
    status: AdoptionApplicationStatus;
    daysAgo: number;
    coordinatorId: string | null;
    phone: string;
    address: string;
  }
): Promise<void> {
  const now = deps.clock.now();
  const createdAt = new Date(now.getTime() - input.daysAgo * DAY);
  const shared = input.status === "in_contact" || input.status === "adopted";
  const closed = input.status === "adopted";
  await deps.db
    .insert(adoptionApplication)
    .values({
      id: input.id,
      adoptionListingId: input.listingId,
      applicantUserId: input.applicantUserId,
      participantProfileId: null,
      dateOfBirthCiphertext: deps.cipher.encrypt(
        APPLICATION_PURPOSE.dob,
        formatIsoDate(bornYearsAgo(now, 34, 50))
      ),
      phoneCiphertext: deps.cipher.encrypt(
        APPLICATION_PURPOSE.phone,
        input.phone
      ),
      addressCiphertext: deps.cipher.encrypt(
        APPLICATION_PURPOSE.address,
        input.address
      ),
      answersCiphertext: deps.cipher.encrypt(
        APPLICATION_PURPOSE.answers,
        JSON.stringify(ANSWERS)
      ),
      contactSharingConsentId: input.consentId,
      status: input.status,
      contactSharedAt: shared ? createdAt : null,
      decidedByUserId: input.coordinatorId,
      closedAt: closed ? now : null,
      createdAt,
      updatedAt: now,
    })
    // Also skips anyone who already has an open application to the animal.
    .onConflictDoNothing();
}

/** The coordinator, the applications and the success story. */
export async function seedAdoptionApplications(deps: SeedDeps): Promise<void> {
  const seed = SEED_ADOPTION_APPLICATIONS;
  const coordinator = await ensureVerifiedAccount(deps, seed.coordinator);
  await ensureGrant(deps, coordinator.id, {
    role: "adoption_coordinator",
    scope: { type: "global" },
  });
  await ensureSeedAuthenticator(deps, coordinator.id);
  const [contactSharing, storyConsent] = await Promise.all([
    latestDocument(deps.db, "adoption_contact_sharing"),
    latestDocument(deps.db, "adoption_success_story"),
  ]);
  if (!contactSharing || !storyConsent) return;

  const submitted = await ensureVerifiedAccount(deps, seed.submitted);
  await ensureApplication(deps, {
    id: seed.submitted.applicationId,
    listingId: SEED_ADOPTION.publishedId,
    applicantUserId: submitted.id,
    consentId: await ensureConsent(
      deps,
      submitted.id,
      "adoption_contact_sharing",
      contactSharing.id
    ),
    status: "submitted",
    daysAgo: 1,
    coordinatorId: null,
    phone: "+919812300001",
    address: "12 Lane 5, Aundh, Pune 411007",
  });

  const inContact = await ensureVerifiedAccount(deps, seed.inContact);
  await ensureApplication(deps, {
    id: seed.inContact.applicationId,
    listingId: SEED_ADOPTION.raniId,
    applicantUserId: inContact.id,
    consentId: await ensureConsent(
      deps,
      inContact.id,
      "adoption_contact_sharing",
      contactSharing.id
    ),
    status: "in_contact",
    daysAgo: 6,
    coordinatorId: coordinator.id,
    phone: "+919812300002",
    address: "B-302 Green Meadows, Baner, Pune 411045",
  });

  const adopter = await ensureVerifiedAccount(deps, seed.adopted);
  await ensureApplication(deps, {
    id: seed.adopted.applicationId,
    listingId: SEED_ADOPTION.adoptedId,
    applicantUserId: adopter.id,
    consentId: await ensureConsent(
      deps,
      adopter.id,
      "adoption_contact_sharing",
      contactSharing.id
    ),
    status: "adopted",
    daysAgo: 25,
    coordinatorId: coordinator.id,
    phone: "+919812300003",
    address: "7 Shanti Nagar, Kothrud, Pune 411038",
  });
  const now = deps.clock.now();
  await deps.db
    .insert(adoptionStory)
    .values({
      id: seed.adopted.storyId,
      applicationId: seed.adopted.applicationId,
      body: STORY,
      status: "published",
      consentEventId: await ensureConsent(
        deps,
        adopter.id,
        "adoption_success_story",
        storyConsent.id
      ),
      publishedAt: now,
      publishedByUserId: coordinator.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}
