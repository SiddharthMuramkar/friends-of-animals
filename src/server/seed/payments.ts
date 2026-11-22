// Payments seed data (#77): one paid and one unpaid batch for the seeded
// verified institution, so previews show both.
//
// - Paid: the institution's registration for Kinder Skies (SKIES26, past
//   its registration), with three of its students confirmed, each with a
//   registration number.
// - Unpaid: an order over the six students enrolled for Neighbours on My
//   Street (NEIGH27), who stay enrolled until it is paid.
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
  institution,
  institutionRegistration,
  paymentBatch,
  paymentBatchItem,
  registration,
} from "../db/schema";
import { ageGroupFor } from "../modules/registration/domain/age-group";
import { parseIsoDate } from "../modules/registration/domain/calendar-date";
import { ageGroupsOf } from "../modules/registration/enrolment-facts";
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
} as const;

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
 * Both batches, after the registration seed, while the institution is
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
}
