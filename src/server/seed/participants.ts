// Participants seed data (#78): two adults who registered themselves for
// Neighbours on My Street (NEIGH27), so previews show both states on the
// participant dashboard.
//
// - Asha Rao (member 1): confirmed, with a registration number, paid in a
//   captured batch of one at the sample individual fee.
// - Ravi Kumar (member 2): waiting for payment, with no batch yet.
//
// Each has their own profile with a fixed FOA Participant ID and consent to
// the documents the competition pinned. The batch names the fake gateway,
// so no deployed gateway ever reads its order. Seed data sends nothing and
// writes no audit entry. Idempotent: rows already there are left alone,
// and an adult who has registered for NEIGH27 on the preview keeps theirs.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq } from "drizzle-orm";

import {
  competition,
  competitionConsentDocument,
  competitionFee,
  consentEvent,
  participantProfile,
  paymentBatch,
  paymentBatchItem,
  registration,
  user,
} from "../db/schema";
import { ageGroupFor } from "../modules/registration/domain/age-group";
import {
  formatIsoDate,
  parseIsoDate,
} from "../modules/registration/domain/calendar-date";
import { identityKeyInput } from "../modules/registration/domain/identity-key";
import { IDENTITY_HASH_PURPOSE } from "../modules/registration/domain/prepare-student";
import { ageGroupsOf } from "../modules/registration/enrolment-facts";
import { PROFILE_PURPOSE } from "../modules/registration/student-profile";
import { SEED_ACCOUNTS } from "./accounts";
import { SEED_TERMS_COMPETITIONS } from "./competition-terms";
import type { SeedDeps } from "./types";

/** Neighbours on My Street, open to adults on their own. */
const COMPETITION_ID = SEED_TERMS_COMPETITIONS.paid;

export const SEED_PARTICIPANTS = {
  confirmed: {
    userId: SEED_ACCOUNTS.members[0].id,
    profileId: "01938a00-0000-7000-8000-000000007801",
    participantCode: "FOA-P-265EED01",
    fullName: "Asha Rao",
    dateOfBirth: "1990-04-12",
    phone: "+919000000101",
    pinCode: "411038",
    city: "Pune",
    state: "Maharashtra",
    registrationId: "01938a00-0000-7000-8000-000000007811",
    registrationNumber: "NEIGH27-R-5EEDA1",
    batchId: "01938a00-0000-7000-8000-000000007821",
    consentEventIds: [
      "01938a00-0000-7000-8000-000000007831",
      "01938a00-0000-7000-8000-000000007832",
    ],
  },
  pending: {
    userId: SEED_ACCOUNTS.members[1].id,
    profileId: "01938a00-0000-7000-8000-000000007802",
    participantCode: "FOA-P-265EED02",
    fullName: "Ravi Kumar",
    dateOfBirth: "1986-11-23",
    phone: "+919000000102",
    pinCode: "560001",
    city: "Bengaluru",
    state: "Karnataka",
    registrationId: "01938a00-0000-7000-8000-000000007812",
    registrationNumber: null,
    batchId: null,
    consentEventIds: [
      "01938a00-0000-7000-8000-000000007833",
      "01938a00-0000-7000-8000-000000007834",
    ],
  },
} as const;

type SeedParticipant =
  (typeof SEED_PARTICIPANTS)[keyof typeof SEED_PARTICIPANTS];

/** One adult's profile, registration, consents and (if paid) batch. */
async function seedParticipant(
  deps: SeedDeps,
  seed: SeedParticipant,
  facts: {
    cutoff: NonNullable<ReturnType<typeof parseIsoDate>>;
    groups: Awaited<ReturnType<typeof ageGroupsOf>>;
    fee: bigint;
    documents: {
      purpose: "competition_terms" | "privacy_notice";
      id: string;
    }[];
  }
): Promise<void> {
  const [account] = await deps.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, seed.userId));
  if (!account) return;
  const birth = parseIsoDate(seed.dateOfBirth);
  const placed = birth && ageGroupFor(birth, facts.cutoff, facts.groups);
  // A preview seeded before NEIGH27 had its adults' group: nothing to add.
  if (!birth || !placed?.ok) return;
  const now = deps.clock.now();

  // Their own profile, unless they registered themselves on the preview.
  await deps.db
    .insert(participantProfile)
    .values({
      id: seed.profileId,
      ownerKind: "self",
      ownerUserId: seed.userId,
      participantCode: seed.participantCode,
      fullName: seed.fullName,
      dobCiphertext: deps.cipher.encrypt(
        PROFILE_PURPOSE.dob,
        formatIsoDate(birth)
      ),
      phoneCiphertext: deps.cipher.encrypt(PROFILE_PURPOSE.phone, seed.phone),
      pinCode: seed.pinCode,
      city: seed.city,
      state: seed.state,
      country: "IN",
      identityHash: deps.blindIndex.of(
        IDENTITY_HASH_PURPOSE,
        identityKeyInput(seed.fullName, birth)
      ),
      createdBy: seed.userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [profile] = await deps.db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(eq(participantProfile.id, seed.profileId));
  if (!profile) return;

  const [registered] = await deps.db
    .insert(registration)
    .values({
      id: seed.registrationId,
      participantProfileId: profile.id,
      competitionId: COMPETITION_ID,
      route: "individual",
      ageGroupId: placed.group.id,
      status: seed.registrationNumber ? "confirmed" : "pending_payment",
      registrationNumber: seed.registrationNumber,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: registration.id });
  if (!registered) return;

  for (const [at, document] of facts.documents.entries()) {
    const id = seed.consentEventIds[at];
    if (!id) continue;
    await deps.db
      .insert(consentEvent)
      .values({
        id,
        subjectType: "user",
        subjectId: seed.userId,
        giverUserId: seed.userId,
        purpose: document.purpose,
        documentId: document.id,
        action: "given",
        method: "web_form",
        occurredAt: now,
      })
      .onConflictDoNothing();
  }

  if (seed.batchId === null || facts.fee <= 0n) return;
  await deps.db
    .insert(paymentBatch)
    .values({
      id: seed.batchId,
      route: "individual",
      competitionId: COMPETITION_ID,
      payerUserId: seed.userId,
      status: "captured",
      amountMinor: facts.fee,
      currency: "INR",
      gateway: "fake",
      gatewayOrderId: `order_seed_${seed.batchId.slice(-4)}`,
      gatewayPaymentId: `pay_seed_${seed.batchId.slice(-4)}`,
      createdAt: now,
      updatedAt: now,
      capturedAt: now,
    })
    .onConflictDoNothing();
  await deps.db
    .insert(paymentBatchItem)
    .values({
      batchId: seed.batchId,
      registrationId: seed.registrationId,
      amountMinor: facts.fee,
    })
    .onConflictDoNothing();
}

/**
 * The two adults, after the competitions, competition terms and identity
 * seeds. Running again changes nothing.
 */
export async function seedParticipants(deps: SeedDeps): Promise<void> {
  const [target] = await deps.db
    .select({ ageCutoffDate: competition.ageCutoffDate })
    .from(competition)
    .where(eq(competition.id, COMPETITION_ID));
  const cutoff = target?.ageCutoffDate && parseIsoDate(target.ageCutoffDate);
  if (!cutoff) return;
  const [fee] = await deps.db
    .select({ amountMinor: competitionFee.amountMinor })
    .from(competitionFee)
    .where(
      and(
        eq(competitionFee.competitionId, COMPETITION_ID),
        eq(competitionFee.route, "individual")
      )
    );
  if (!fee) return;
  const pinned = await deps.db
    .select({
      purpose: competitionConsentDocument.purpose,
      id: competitionConsentDocument.consentDocumentId,
    })
    .from(competitionConsentDocument)
    .where(eq(competitionConsentDocument.competitionId, COMPETITION_ID))
    .orderBy(competitionConsentDocument.purpose);
  const documents = pinned.flatMap((document) =>
    document.purpose === "competition_terms" ||
    document.purpose === "privacy_notice"
      ? [{ purpose: document.purpose, id: document.id }]
      : []
  );
  const facts = {
    cutoff,
    groups: await ageGroupsOf(deps.db, COMPETITION_ID),
    fee: fee.amountMinor,
    documents,
  };
  for (const seed of Object.values(SEED_PARTICIPANTS)) {
    await seedParticipant(deps, seed, facts);
  }
}
