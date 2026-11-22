// Refunds seed data (#80), so previews show the finance queue with work in
// it and a refund that is done:
//
// - Waiting for finance: a partial refund of one of the three students of
//   the payments seed's paid Kinder Skies batch, asked for by the seeded
//   staff admin. Its student stays confirmed until finance decides.
// - Refunded: a whole-batch refund of a one-student Kinder Skies batch
//   (the seed's seventh student, who has no other Kinder Skies entry),
//   processed by the fake gateway: the registration is refunded.
//
// Preview data, not a decision anyone took: the refunded one names no
// approver, and the seed sends nothing and writes no audit entry. Both
// name the fake gateway, so no deployed gateway is ever asked about them.
// Idempotent: rows already there are left alone.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { eq } from "drizzle-orm";

import {
  competition,
  institution,
  paymentBatch,
  paymentBatchItem,
  refund,
  refundItem,
  registration,
} from "../db/schema";
import { ageGroupFor } from "../modules/registration/domain/age-group";
import { parseIsoDate } from "../modules/registration/domain/calendar-date";
import { ageGroupsOf } from "../modules/registration/enrolment-facts";
import { SEED_ACCOUNTS } from "./accounts";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_PAYMENTS } from "./payments";
import { SEED_STUDENTS } from "./registration";
import type { SeedDeps } from "./types";

/** The payments seed's sample fee: ₹1,000 a student, in paise. */
const SAMPLE_FEE = 100_000n;

export const SEED_REFUNDS = {
  /** Waiting for finance: one student of the paid batch. */
  requested: {
    refundId: "01938a00-0000-7000-8000-000000008301",
    batchId: SEED_PAYMENTS.paid.batchId,
    registrationId: SEED_PAYMENTS.paid.students[0].registrationId,
    gatewayPaymentId: "pay_seed_paid",
  },
  /** Done: a whole batch of one, refunded through the fake gateway. */
  refunded: {
    refundId: "01938a00-0000-7000-8000-000000008302",
    batchId: "01938a00-0000-7000-8000-000000008201",
    registrationId: "01938a00-0000-7000-8000-000000008101",
    registrationNumber: "SKIES26-R-5EED07",
    profileOf: SEED_STUDENTS[6]!.profileId,
    dateOfBirth: SEED_STUDENTS[6]!.dateOfBirth,
    gatewayPaymentId: "pay_seed_refunded",
    gatewayRefundId: "rfnd_seed_refunded",
  },
} as const;

/** The seeded staff admin, who asks for both. */
const REQUESTER = SEED_ACCOUNTS.members[1].id;

async function seedRequestedRefund(deps: SeedDeps): Promise<void> {
  const seed = SEED_REFUNDS.requested;
  const [batch] = await deps.db
    .select({ status: paymentBatch.status })
    .from(paymentBatch)
    .where(eq(paymentBatch.id, seed.batchId));
  if (batch?.status !== "captured") return;
  const now = deps.clock.now();
  const [made] = await deps.db
    .insert(refund)
    .values({
      id: seed.refundId,
      batchId: seed.batchId,
      gatewayPaymentId: seed.gatewayPaymentId,
      kind: "discretionary",
      status: "requested",
      method: "gateway",
      amountMinor: SAMPLE_FEE,
      currency: "INR",
      reason:
        "The family moved abroad before the competition began; the school asked for this student's fee back.",
      requestedBy: REQUESTER,
      requestedAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: refund.id });
  if (!made) return;
  await deps.db.insert(refundItem).values({
    refundId: seed.refundId,
    batchId: seed.batchId,
    registrationId: seed.registrationId,
    amountMinor: SAMPLE_FEE,
  });
}

async function seedRefundedBatch(deps: SeedDeps): Promise<void> {
  const seed = SEED_REFUNDS.refunded;
  const paid = SEED_PAYMENTS.paid;
  const [target] = await deps.db
    .select({ ageCutoffDate: competition.ageCutoffDate })
    .from(competition)
    .where(eq(competition.id, paid.competitionId));
  const cutoff = target?.ageCutoffDate && parseIsoDate(target.ageCutoffDate);
  const birth = parseIsoDate(seed.dateOfBirth);
  if (!cutoff || !birth) return;
  const placed = ageGroupFor(
    birth,
    cutoff,
    await ageGroupsOf(deps.db, paid.competitionId)
  );
  if (!placed.ok) throw new Error(`Seed student ${seed.profileOf} fits no group`);
  const now = deps.clock.now();
  await deps.db
    .insert(registration)
    .values({
      id: seed.registrationId,
      participantProfileId: seed.profileOf,
      competitionId: paid.competitionId,
      route: "institution",
      institutionRegistrationId: paid.institutionRegistrationId,
      ageGroupId: placed.group.id,
      status: "refunded",
      registrationNumber: seed.registrationNumber,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [ours] = await deps.db
    .select({ id: registration.id })
    .from(registration)
    .where(eq(registration.id, seed.registrationId));
  if (!ours) return;
  const [batch] = await deps.db
    .insert(paymentBatch)
    .values({
      id: seed.batchId,
      route: "institution",
      competitionId: paid.competitionId,
      institutionId: SEED_INSTITUTIONS.verified.id,
      institutionRegistrationId: paid.institutionRegistrationId,
      status: "captured",
      amountMinor: SAMPLE_FEE,
      currency: "INR",
      gateway: "fake",
      gatewayOrderId: "order_seed_refunded",
      gatewayPaymentId: seed.gatewayPaymentId,
      captureMethod: "gateway",
      createdAt: now,
      updatedAt: now,
      capturedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: paymentBatch.id });
  if (!batch) return;
  await deps.db.insert(paymentBatchItem).values({
    batchId: seed.batchId,
    registrationId: seed.registrationId,
    amountMinor: SAMPLE_FEE,
  });
  await deps.db.insert(refund).values({
    id: seed.refundId,
    batchId: seed.batchId,
    gatewayPaymentId: seed.gatewayPaymentId,
    kind: "discretionary",
    status: "refunded",
    method: "gateway",
    amountMinor: SAMPLE_FEE,
    currency: "INR",
    reason: "The student fell ill and couldn't take part; the school asked for the fee back.",
    requestedBy: REQUESTER,
    requestedAt: now,
    decidedAt: now,
    decisionNote: "Within the refund policy.",
    gatewayRefundId: seed.gatewayRefundId,
    sentAt: now,
    refundedAt: now,
    updatedAt: now,
  });
  await deps.db.insert(refundItem).values({
    refundId: seed.refundId,
    batchId: seed.batchId,
    registrationId: seed.registrationId,
    amountMinor: SAMPLE_FEE,
  });
}

/**
 * Both refunds, after the payments seed, while the institution is
 * verified. Running again changes nothing.
 */
export async function seedRefunds(deps: SeedDeps): Promise<void> {
  const [verified] = await deps.db
    .select({ status: institution.status })
    .from(institution)
    .where(eq(institution.id, SEED_INSTITUTIONS.verified.id));
  if (verified?.status !== "verified") return;
  await seedRequestedRefund(deps);
  await seedRefundedBatch(deps);
}
