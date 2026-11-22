// Payments seed data (#77): one paid and one unpaid batch for the seeded
// verified institution, so previews show both.
//
// - Paid: the institution's registration for Kinder Skies (SKIES26, past
//   its registration), with three of its students confirmed, each with a
//   registration number.
// - Unpaid: an order over the six students enrolled for Neighbours on My
//   Street (NEIGH27), who stay enrolled until it is paid.
// - Paid by cheque (#79): two more Kinder Skies students, confirmed, their
//   batch captured offline with the cheque's row and a proof file (metadata
//   only, like the files seed: no object, so its link leads nowhere),
//   recorded by the seeded staff admin.
// - In review (#79): one more Kinder Skies student, still enrolled, whose
//   order the gateway reported paid after registration closed: the batch
//   is in review with an open `registration_closed` case.
//
// Amounts are samples, not FOA's prices (HR-34). Both batches name the
// fake gateway, so no deployed gateway ever reads their orders: paying
// again on a preview replaces the unpaid batch with a real order. Seed
// data sends nothing and writes no audit entry. Idempotent: rows already
// there are left alone, and the unpaid batch is skipped once anyone has
// paid (or started to pay) for the registration on the preview.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  competition,
  fileAsset,
  institution,
  institutionRegistration,
  offlinePayment,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  registration,
} from "../db/schema";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { istDate } from "../modules/payments/domain/offline-payment";
import { ageGroupFor } from "../modules/registration/domain/age-group";
import { parseIsoDate } from "../modules/registration/domain/calendar-date";
import { ageGroupsOf } from "../modules/registration/enrolment-facts";
import { SEED_ACCOUNTS } from "./accounts";
import { seedFilesLocation, type SeedFilesLocation } from "./files";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_REGISTRATIONS, SEED_STUDENTS } from "./registration";
import type { SeedDeps } from "./types";

/** A sample fee of ₹1,000 a student, in paise. */
const SAMPLE_FEE = 100_000n;

export const SEED_PAYMENTS = {
  paid: {
    institutionRegistrationId: "01938a00-0000-7000-8000-000000007001",
    reference: "SKIES26-I-5EED2",
    // Kinder Skies, from the competitions seed.
    competitionId: "01938a00-0000-7000-8000-000000002103",
    batchId: "01938a00-0000-7000-8000-000000007201",
    /** Three of the seeded students, by their NEIGH27 registration. */
    students: [
      {
        profileOf: SEED_STUDENTS[0]!.profileId,
        dateOfBirth: SEED_STUDENTS[0]!.dateOfBirth,
        registrationId: "01938a00-0000-7000-8000-000000007101",
        registrationNumber: "SKIES26-R-5EED01",
      },
      {
        profileOf: SEED_STUDENTS[1]!.profileId,
        dateOfBirth: SEED_STUDENTS[1]!.dateOfBirth,
        registrationId: "01938a00-0000-7000-8000-000000007102",
        registrationNumber: "SKIES26-R-5EED02",
      },
      {
        profileOf: SEED_STUDENTS[3]!.profileId,
        dateOfBirth: SEED_STUDENTS[3]!.dateOfBirth,
        registrationId: "01938a00-0000-7000-8000-000000007103",
        registrationNumber: "SKIES26-R-5EED03",
      },
    ],
  },
  unpaid: {
    batchId: "01938a00-0000-7000-8000-000000007202",
  },
  /** #79: paid by cheque, recorded by the seeded staff admin. */
  cheque: {
    batchId: "01938a00-0000-7000-8000-000000007203",
    offlinePaymentId: "01938a00-0000-7000-8000-000000007301",
    proofFileId: "01938a00-0000-7000-8000-000000007302",
    students: [
      {
        profileOf: SEED_STUDENTS[2]!.profileId,
        dateOfBirth: SEED_STUDENTS[2]!.dateOfBirth,
        registrationId: "01938a00-0000-7000-8000-000000007104",
        registrationNumber: "SKIES26-R-5EED04",
      },
      {
        profileOf: SEED_STUDENTS[4]!.profileId,
        dateOfBirth: SEED_STUDENTS[4]!.dateOfBirth,
        registrationId: "01938a00-0000-7000-8000-000000007105",
        registrationNumber: "SKIES26-R-5EED05",
      },
    ],
  },
  /** #79: paid after registration closed; its case is open. */
  inReview: {
    batchId: "01938a00-0000-7000-8000-000000007204",
    caseId: "01938a00-0000-7000-8000-000000007303",
    students: [
      {
        profileOf: SEED_STUDENTS[5]!.profileId,
        dateOfBirth: SEED_STUDENTS[5]!.dateOfBirth,
        registrationId: "01938a00-0000-7000-8000-000000007106",
        registrationNumber: null,
      },
    ],
  },
} as const;

type SeedPaidStudent = {
  profileOf: string;
  dateOfBirth: string;
  registrationId: string;
  registrationNumber: string | null;
};

/**
 * Kinder Skies' students in `students`, confirmed with their number or
 * still enrolled. Returns false unless every one is there afterwards.
 */
async function seedSkiesStudents(
  deps: SeedDeps,
  students: readonly SeedPaidStudent[]
): Promise<boolean> {
  const seed = SEED_PAYMENTS.paid;
  const [target] = await deps.db
    .select({ ageCutoffDate: competition.ageCutoffDate })
    .from(competition)
    .where(eq(competition.id, seed.competitionId));
  const cutoff = target?.ageCutoffDate && parseIsoDate(target.ageCutoffDate);
  if (!cutoff) return false;
  const groups = await ageGroupsOf(deps.db, seed.competitionId);
  const now = deps.clock.now();
  for (const student of students) {
    const birth = parseIsoDate(student.dateOfBirth);
    const placed = birth && ageGroupFor(birth, cutoff, groups);
    if (!placed?.ok)
      throw new Error(`Seed student ${student.profileOf} fits no group`);
    await deps.db
      .insert(registration)
      .values({
        id: student.registrationId,
        participantProfileId: student.profileOf,
        competitionId: seed.competitionId,
        route: "institution",
        institutionRegistrationId: seed.institutionRegistrationId,
        ageGroupId: placed.group.id,
        status: student.registrationNumber ? "confirmed" : "enrolled",
        registrationNumber: student.registrationNumber,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
  const ours = await deps.db
    .select({ id: registration.id })
    .from(registration)
    .where(
      inArray(
        registration.id,
        students.map((student) => student.registrationId)
      )
    );
  return ours.length === students.length;
}

/** Two Kinder Skies students paid for by cheque, with its row and proof. */
async function seedChequeBatch(
  deps: SeedDeps,
  files: SeedFilesLocation
): Promise<void> {
  const seed = SEED_PAYMENTS.cheque;
  if (!(await seedSkiesStudents(deps, seed.students))) return;
  const recorder = SEED_ACCOUNTS.members[1].id;
  const now = deps.clock.now();
  const [batch] = await deps.db
    .insert(paymentBatch)
    .values({
      id: seed.batchId,
      route: "institution",
      competitionId: SEED_PAYMENTS.paid.competitionId,
      institutionId: SEED_INSTITUTIONS.verified.id,
      institutionRegistrationId: SEED_PAYMENTS.paid.institutionRegistrationId,
      status: "captured",
      amountMinor: SAMPLE_FEE * BigInt(seed.students.length),
      currency: "INR",
      gateway: "fake",
      captureMethod: "offline",
      createdAt: now,
      updatedAt: now,
      capturedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: paymentBatch.id });
  if (!batch) return;
  await deps.db.insert(paymentBatchItem).values(
    seed.students.map((student) => ({
      batchId: seed.batchId,
      registrationId: student.registrationId,
      amountMinor: SAMPLE_FEE,
    }))
  );
  await deps.db
    .insert(fileAsset)
    .values({
      id: seed.proofFileId,
      ownerUserId: recorder,
      purpose: "offline_payment_proof",
      contentType: "application/pdf",
      sizeBytes: 2048,
      bucket: files.bucket,
      storageKey: storageKeyFor({
        prefix: files.keyPrefix,
        purpose: "offline_payment_proof",
        fileId: seed.proofFileId,
      }),
      status: "clean",
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await deps.db.insert(offlinePayment).values({
    id: seed.offlinePaymentId,
    batchId: seed.batchId,
    method: "cheque",
    reference: "004512",
    amountMinor: SAMPLE_FEE * BigInt(seed.students.length),
    receivedOn: istDate(now),
    proofFileAssetId: seed.proofFileId,
    recordedByUserId: recorder,
    recordedAt: now,
  });
}

/** A Kinder Skies student whose payment came after the close, in review. */
async function seedReviewBatch(deps: SeedDeps): Promise<void> {
  const seed = SEED_PAYMENTS.inReview;
  if (!(await seedSkiesStudents(deps, seed.students))) return;
  const now = deps.clock.now();
  const amountMinor = SAMPLE_FEE * BigInt(seed.students.length);
  const [batch] = await deps.db
    .insert(paymentBatch)
    .values({
      id: seed.batchId,
      route: "institution",
      competitionId: SEED_PAYMENTS.paid.competitionId,
      institutionId: SEED_INSTITUTIONS.verified.id,
      institutionRegistrationId: SEED_PAYMENTS.paid.institutionRegistrationId,
      status: "needs_review",
      amountMinor,
      currency: "INR",
      gateway: "fake",
      gatewayOrderId: "order_seed_review",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: paymentBatch.id });
  if (!batch) return;
  await deps.db.insert(paymentBatchItem).values(
    seed.students.map((student) => ({
      batchId: seed.batchId,
      registrationId: student.registrationId,
      amountMinor: SAMPLE_FEE,
    }))
  );
  await deps.db.insert(paymentReviewCase).values({
    id: seed.caseId,
    batchId: seed.batchId,
    reason: "registration_closed",
    gatewayPaymentId: "pay_seed_review",
    amountMinor,
    currency: "INR",
    batchStatusBefore: "order_created",
    openedAt: now,
  });
}

/** Kinder Skies' registration, its three confirmed students and their batch. */
async function seedPaidBatch(deps: SeedDeps): Promise<void> {
  const seed = SEED_PAYMENTS.paid;
  const [target] = await deps.db
    .select({ ageCutoffDate: competition.ageCutoffDate })
    .from(competition)
    .where(eq(competition.id, seed.competitionId));
  const cutoff = target?.ageCutoffDate && parseIsoDate(target.ageCutoffDate);
  if (!cutoff) return;
  const groups = await ageGroupsOf(deps.db, seed.competitionId);
  const now = deps.clock.now();
  await deps.db
    .insert(institutionRegistration)
    .values({
      id: seed.institutionRegistrationId,
      institutionId: SEED_INSTITUTIONS.verified.id,
      competitionId: seed.competitionId,
      reference: seed.reference,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [registered] = await deps.db
    .select({ id: institutionRegistration.id })
    .from(institutionRegistration)
    .where(eq(institutionRegistration.id, seed.institutionRegistrationId));
  if (!registered) return;

  for (const student of seed.students) {
    const birth = parseIsoDate(student.dateOfBirth);
    const placed = birth && ageGroupFor(birth, cutoff, groups);
    if (!placed?.ok)
      throw new Error(`Seed student ${student.profileOf} fits no group`);
    await deps.db
      .insert(registration)
      .values({
        id: student.registrationId,
        participantProfileId: student.profileOf,
        competitionId: seed.competitionId,
        route: "institution",
        institutionRegistrationId: seed.institutionRegistrationId,
        ageGroupId: placed.group.id,
        status: "confirmed",
        registrationNumber: student.registrationNumber,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
  const ours = await deps.db
    .select({ id: registration.id })
    .from(registration)
    .where(
      inArray(
        registration.id,
        seed.students.map((student) => student.registrationId)
      )
    );
  if (ours.length !== seed.students.length) return;

  const [batch] = await deps.db
    .insert(paymentBatch)
    .values({
      id: seed.batchId,
      route: "institution",
      competitionId: seed.competitionId,
      institutionId: SEED_INSTITUTIONS.verified.id,
      institutionRegistrationId: seed.institutionRegistrationId,
      status: "captured",
      amountMinor: SAMPLE_FEE * BigInt(seed.students.length),
      currency: "INR",
      gateway: "fake",
      gatewayOrderId: "order_seed_paid",
      gatewayPaymentId: "pay_seed_paid",
      createdAt: now,
      updatedAt: now,
      capturedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: paymentBatch.id });
  if (!batch) return;
  await deps.db.insert(paymentBatchItem).values(
    seed.students.map((student) => ({
      batchId: seed.batchId,
      registrationId: student.registrationId,
      amountMinor: SAMPLE_FEE,
    }))
  );
}

/** An open order over NEIGH27's enrolled students, unless one exists. */
async function seedUnpaidBatch(deps: SeedDeps): Promise<void> {
  const seed = SEED_REGISTRATIONS.institution;
  const [anyBatch] = await deps.db
    .select({ id: paymentBatch.id })
    .from(paymentBatch)
    .where(eq(paymentBatch.institutionRegistrationId, seed.id))
    .limit(1);
  if (anyBatch) return;
  const enrolled = SEED_STUDENTS.filter(
    (student) => student.status === "enrolled"
  ).map((student) => student.registrationId);
  const stillEnrolled = await deps.db
    .select({ id: registration.id })
    .from(registration)
    .leftJoin(
      paymentBatchItem,
      and(
        eq(paymentBatchItem.registrationId, registration.id),
        isNull(paymentBatchItem.releasedAt)
      )
    )
    .where(
      and(
        inArray(registration.id, enrolled),
        eq(registration.status, "enrolled"),
        isNull(paymentBatchItem.batchId)
      )
    );
  if (stillEnrolled.length !== enrolled.length) return;

  const now = deps.clock.now();
  await deps.db.insert(paymentBatch).values({
    id: SEED_PAYMENTS.unpaid.batchId,
    route: "institution",
    competitionId: seed.competitionId,
    institutionId: seed.institutionId,
    institutionRegistrationId: seed.id,
    status: "order_created",
    amountMinor: SAMPLE_FEE * BigInt(enrolled.length),
    currency: "INR",
    gateway: "fake",
    gatewayOrderId: "order_seed_unpaid",
    createdAt: now,
    updatedAt: now,
  });
  await deps.db.insert(paymentBatchItem).values(
    enrolled.map((registrationId) => ({
      batchId: SEED_PAYMENTS.unpaid.batchId,
      registrationId,
      amountMinor: SAMPLE_FEE,
    }))
  );
}

/**
 * Every batch, after the registration seed, while the institution is
 * verified. Running again changes nothing.
 */
export async function seedPayments(deps: SeedDeps): Promise<void> {
  const [verified] = await deps.db
    .select({ id: institution.id })
    .from(institution)
    .where(
      and(
        eq(institution.id, SEED_INSTITUTIONS.verified.id),
        eq(institution.status, "verified")
      )
    );
  if (!verified) return;
  await seedPaidBatch(deps);
  await seedUnpaidBatch(deps);
  // The proof sits at this deployment's bucket and prefix, as the files
  // seed's demo files do.
  await seedChequeBatch(deps, seedFilesLocation());
  await seedReviewBatch(deps);
}
