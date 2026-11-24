// Volunteers seed data (#123): a community manager with the seed
// authenticator, an approved adult volunteer, an adult's application
// waiting for the community team, and the seeded teen's (Rohan Desai's)
// application waiting for his guardian, Kavita Desai. Each applicant has
// accepted version 1 of both declarations, which the consent seed
// publishes. Runs after the consent and guardians seeds. Seed data sends
// nothing and writes no audit entry. Idempotent: rows already there, and
// anyone who already has an open application, are left alone.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq } from "drizzle-orm";

import {
  consentEvent,
  participantProfile,
  volunteerApplication,
} from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { uuidv7 } from "../ids";
import { latestDocument } from "../modules/consent/repository";
import { formatIsoDate } from "../modules/registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../modules/registration/student-profile";
import { DATE_OF_BIRTH_PURPOSE } from "../modules/volunteers/application-record";
import type { Availability } from "../modules/volunteers/domain/application-input";
import type { VolunteerApplicationStatus } from "../modules/volunteers/domain/application-status";
import { DECLARATION_PURPOSES } from "../modules/volunteers/declarations";
import { ensureGrant } from "./access";
import { bornYearsAgo, SEED_GUARDIANS } from "./guardians";
import { ensureSeedAuthenticator } from "./second-factor";
import type { SeedDeps } from "./types";

export const SEED_VOLUNTEERS = {
  manager: {
    name: "Neha Kapoor",
    email: "community-manager@example.test",
  },
  approved: {
    name: "Priya Nair",
    email: "volunteer1@example.test",
    age: 26,
    applicationId: "01938a00-0000-7000-8000-000000012301",
  },
  submitted: {
    name: "Arjun Mehta",
    email: "volunteer2@example.test",
    age: 34,
    applicationId: "01938a00-0000-7000-8000-000000012302",
  },
  teen: {
    ...SEED_GUARDIANS.teen,
    profileId: SEED_GUARDIANS.children.teen.profileId,
    applicationId: "01938a00-0000-7000-8000-000000012303",
  },
} as const;

const WEEKENDS: Availability = {
  slots: [
    { day: "saturday", part: "morning" },
    { day: "sunday", part: "afternoon" },
  ],
  note: null,
};

/**
 * The user's acceptance of both declarations, on the given versions: the
 * events already there, or new ones.
 */
async function ensureDeclarations(
  deps: SeedDeps,
  userId: string,
  documents: { safeguarding: string; conduct: string }
): Promise<{ safeguarding: string; conduct: string }> {
  const ids = { safeguarding: "", conduct: "" };
  for (const key of ["safeguarding", "conduct"] as const) {
    const purpose = DECLARATION_PURPOSES[key];
    const [given] = await deps.db
      .select({ id: consentEvent.id })
      .from(consentEvent)
      .where(
        and(
          eq(consentEvent.subjectType, "user"),
          eq(consentEvent.subjectId, userId),
          eq(consentEvent.purpose, purpose),
          eq(consentEvent.documentId, documents[key]),
          eq(consentEvent.action, "given")
        )
      )
      .limit(1);
    if (given) {
      ids[key] = given.id;
      continue;
    }
    const now = deps.clock.now();
    const id = uuidv7(new Date(now.getTime() + (key === "conduct" ? 1 : 0)));
    await deps.db.insert(consentEvent).values({
      id,
      subjectType: "user",
      subjectId: userId,
      giverUserId: userId,
      purpose,
      documentId: documents[key],
      action: "given",
      method: "web_form",
      occurredAt: now,
    });
    ids[key] = id;
  }
  return ids;
}

async function ensureApplication(
  deps: SeedDeps,
  application: {
    id: string;
    applicantUserId: string;
    participantProfileId: string | null;
    dateOfBirth: string;
    interests: (typeof volunteerApplication.$inferInsert)["interests"];
    status: VolunteerApplicationStatus;
    decision?: {
      decidedByUserId: string;
      safeguardingConsentId: string;
      conductConsentId: string;
    };
  }
): Promise<void> {
  const now = deps.clock.now();
  await deps.db
    .insert(volunteerApplication)
    .values({
      id: application.id,
      applicantUserId: application.applicantUserId,
      participantProfileId: application.participantProfileId,
      dateOfBirthCiphertext: deps.cipher.encrypt(
        DATE_OF_BIRTH_PURPOSE,
        application.dateOfBirth
      ),
      interests: application.interests,
      availability: WEEKENDS,
      status: application.status,
      ...(application.decision
        ? { ...application.decision, decidedAt: now, closedAt: now }
        : {}),
      createdAt: now,
      updatedAt: now,
    })
    // Also skips anyone who already has an open application.
    .onConflictDoNothing();
}

/** The volunteers' accounts, declarations, applications and role. */
export async function seedVolunteers(deps: SeedDeps): Promise<void> {
  const now = deps.clock.now();
  const [safeguarding, conduct] = await Promise.all([
    latestDocument(deps.db, DECLARATION_PURPOSES.safeguarding),
    latestDocument(deps.db, DECLARATION_PURPOSES.conduct),
  ]);
  const manager = await ensureVerifiedAccount(deps, SEED_VOLUNTEERS.manager);
  await ensureGrant(deps, manager.id, {
    role: "community_manager",
    scope: { type: "global" },
  });
  await ensureSeedAuthenticator(deps, manager.id);
  if (!safeguarding || !conduct) return;
  const documents = { safeguarding: safeguarding.id, conduct: conduct.id };

  const approved = await ensureVerifiedAccount(deps, SEED_VOLUNTEERS.approved);
  const approvedConsents = await ensureDeclarations(
    deps,
    approved.id,
    documents
  );
  await ensureApplication(deps, {
    id: SEED_VOLUNTEERS.approved.applicationId,
    applicantUserId: approved.id,
    participantProfileId: null,
    dateOfBirth: formatIsoDate(
      bornYearsAgo(now, SEED_VOLUNTEERS.approved.age, 40)
    ),
    interests: ["content", "social_media"],
    status: "approved",
    decision: {
      decidedByUserId: manager.id,
      safeguardingConsentId: approvedConsents.safeguarding,
      conductConsentId: approvedConsents.conduct,
    },
  });
  await ensureGrant(deps, approved.id, {
    role: "volunteer",
    scope: { type: "global" },
  });

  const submitted = await ensureVerifiedAccount(
    deps,
    SEED_VOLUNTEERS.submitted
  );
  await ensureDeclarations(deps, submitted.id, documents);
  await ensureApplication(deps, {
    id: SEED_VOLUNTEERS.submitted.applicationId,
    applicantUserId: submitted.id,
    participantProfileId: null,
    dateOfBirth: formatIsoDate(
      bornYearsAgo(now, SEED_VOLUNTEERS.submitted.age, 100)
    ),
    interests: ["technology", "competition_management"],
    status: "submitted",
  });

  // Rohan's application, on the profile Kavita keeps, if the guardians
  // seed linked his login to it.
  const teen = await ensureVerifiedAccount(deps, {
    name: SEED_VOLUNTEERS.teen.name,
    email: SEED_VOLUNTEERS.teen.email,
  });
  const [profile] = await deps.db
    .select({ dobCiphertext: participantProfile.dobCiphertext })
    .from(participantProfile)
    .where(
      and(
        eq(participantProfile.id, SEED_VOLUNTEERS.teen.profileId),
        eq(participantProfile.loginUserId, teen.id)
      )
    );
  if (!profile) return;
  await ensureDeclarations(deps, teen.id, documents);
  await ensureApplication(deps, {
    id: SEED_VOLUNTEERS.teen.applicationId,
    applicantUserId: teen.id,
    participantProfileId: SEED_VOLUNTEERS.teen.profileId,
    dateOfBirth: deps.cipher.decrypt(
      PROFILE_PURPOSE.dob,
      profile.dobCiphertext
    ),
    interests: ["outreach", "community_building"],
    status: "awaiting_guardian",
  });
}
