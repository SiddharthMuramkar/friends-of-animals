// A cancelled competition (#80), so previews show what cancelling leaves
// behind: "Wings at Dusk" (WINGS26), published, then cancelled by a super
// admin, with the seeded verified institution's registration in it and
// two of its students:
//
// - Refunded: a paid student. Their batch was captured through the fake
//   gateway, and the cancellation refund (approved by the system, as
//   cancelCompetition approves it) went back: the registration is
//   refunded.
// - Cancelled: a student nobody had paid for yet.
//
// Preview data, not a decision anyone took: no audit entry, nothing sent,
// and nobody named as having cancelled it. The batch names the fake
// gateway, so no deployed gateway is ever asked about it. Idempotent:
// once the competition is there, nothing is added again.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { eq } from "drizzle-orm";

import {
  competition,
  institution,
  institutionRegistration,
  paymentBatch,
  paymentBatchItem,
  refund,
  refundItem,
  registration,
} from "../db/schema";
import { instantToIstLocal } from "../modules/competitions/domain/ist";
import { DEFAULT_FIELDS } from "../modules/competitions/fields";
import { ageGroupFor } from "../modules/registration/domain/age-group";
import { parseIsoDate } from "../modules/registration/domain/calendar-date";
import { ageGroupsOf } from "../modules/registration/enrolment-facts";
import { insertCompetition } from "./competitions";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_STUDENTS } from "./registration";
import type { SeedDeps } from "./types";

/** The sample fee: ₹800 a student, in paise. */
const SAMPLE_FEE = 80_000n;

const DAY_MS = 24 * 60 * 60 * 1000;

export const SEED_CANCELLED = {
  competitionId: "01938a00-0000-7000-8000-000000002104",
  institutionRegistrationId: "01938a00-0000-7000-8000-000000009001",
  reference: "WINGS26-I-5EED3",
  batchId: "01938a00-0000-7000-8000-000000009201",
  refundId: "01938a00-0000-7000-8000-000000009301",
  gatewayPaymentId: "pay_seed_cancelled",
  gatewayRefundId: "rfnd_seed_cancelled",
  refunded: {
    registrationId: "01938a00-0000-7000-8000-000000009101",
    registrationNumber: "WINGS26-R-5EED01",
    student: SEED_STUDENTS[0]!,
  },
  cancelled: {
    registrationId: "01938a00-0000-7000-8000-000000009102",
    student: SEED_STUDENTS[1]!,
  },
} as const;

const REASON =
  "The monsoon flooded the venue, and no other date before the school exams worked for the schools taking part.";

async function insertCancelledCompetition(deps: SeedDeps): Promise<boolean> {
  const now = deps.clock.now();
  const ist = (days: number, time: string) =>
    `${instantToIstLocal(new Date(now.getTime() + days * DAY_MS)).slice(0, 10)}T${time}`;
  return insertCompetition(deps, {
    id: SEED_CANCELLED.competitionId,
    status: "cancelled",
    slug: "wings-at-dusk",
    publishedAt: new Date(now.getTime() - 45 * DAY_MS),
    cancelled: { at: new Date(now.getTime() - 2 * DAY_MS), reason: REASON },
    fields: {
      ...DEFAULT_FIELDS,
      code: "WINGS26",
      name: "Wings at Dusk",
      theme:
        "Bats, owls and nightjars come out as the sun sets. Show how we can share the evening with them.",
      welfareMessage:
        "Night creatures need dark corners and quiet trees. Switching off an extra light helps them.",
      rules:
        "One original artwork per participant, made by the participant alone. No tracing, no AI-generated work.",
      permittedMaterials:
        "Pencil, crayon, oil pastel, watercolour or poster colour on A3 paper.",
      duration: "2 hours",
      participation: "institutions",
      disciplines: ["drawing", "painting"],
      ageGroups: [
        { label: "Group A", minAge: 5, maxAge: 8 },
        { label: "Group B", minAge: 9, maxAge: 12 },
        { label: "Group C", minAge: 13, maxAge: 17 },
      ],
      ageCutoffDate: "2026-11-01",
      keyDates: {
        registration_opens: ist(-30, "09:00"),
        registration_closes: ist(40, "23:59"),
        submissions_close: ist(60, "23:59"),
      },
    },
  });
}

/** The age group a seeded student falls in, for this competition. */
async function groupOf(
  deps: SeedDeps,
  dateOfBirth: string
): Promise<string | null> {
  const cutoff = parseIsoDate("2026-11-01");
  const birth = parseIsoDate(dateOfBirth);
  if (!cutoff || !birth) return null;
  const placed = ageGroupFor(
    birth,
    cutoff,
    await ageGroupsOf(deps.db, SEED_CANCELLED.competitionId)
  );
  if (!placed.ok) throw new Error(`Seed student ${dateOfBirth} fits no group`);
  return placed.group.id;
}

async function seedRegistrations(deps: SeedDeps): Promise<void> {
  const seed = SEED_CANCELLED;
  const now = deps.clock.now();
  await deps.db.insert(institutionRegistration).values({
    id: seed.institutionRegistrationId,
    institutionId: SEED_INSTITUTIONS.verified.id,
    competitionId: seed.competitionId,
    reference: seed.reference,
    createdAt: now,
    updatedAt: now,
  });
  for (const [entry, status] of [
    [seed.refunded, "refunded"],
    [seed.cancelled, "cancelled"],
  ] as const) {
    const ageGroupId = await groupOf(deps, entry.student.dateOfBirth);
    if (!ageGroupId) return;
    await deps.db.insert(registration).values({
      id: entry.registrationId,
      participantProfileId: entry.student.profileId,
      competitionId: seed.competitionId,
      route: "institution",
      institutionRegistrationId: seed.institutionRegistrationId,
      ageGroupId,
      status,
      registrationNumber:
        "registrationNumber" in entry ? entry.registrationNumber : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  await deps.db.insert(paymentBatch).values({
    id: seed.batchId,
    route: "institution",
    competitionId: seed.competitionId,
    institutionId: SEED_INSTITUTIONS.verified.id,
    institutionRegistrationId: seed.institutionRegistrationId,
    status: "captured",
    amountMinor: SAMPLE_FEE,
    currency: "INR",
    gateway: "fake",
    gatewayOrderId: "order_seed_cancelled",
    gatewayPaymentId: seed.gatewayPaymentId,
    captureMethod: "gateway",
    createdAt: now,
    updatedAt: now,
    capturedAt: now,
  });
  await deps.db.insert(paymentBatchItem).values({
    batchId: seed.batchId,
    registrationId: seed.refunded.registrationId,
    amountMinor: SAMPLE_FEE,
  });
  await deps.db.insert(refund).values({
    id: seed.refundId,
    batchId: seed.batchId,
    gatewayPaymentId: seed.gatewayPaymentId,
    kind: "cancellation",
    status: "refunded",
    method: "gateway",
    amountMinor: SAMPLE_FEE,
    currency: "INR",
    reason: REASON,
    requestedAt: now,
    decidedAt: now,
    idempotencyKey: `cancellation:${seed.competitionId}:${seed.batchId}`,
    gatewayRefundId: seed.gatewayRefundId,
    sentAt: now,
    refundedAt: now,
    updatedAt: now,
  });
  await deps.db.insert(refundItem).values({
    refundId: seed.refundId,
    batchId: seed.batchId,
    registrationId: seed.refunded.registrationId,
    amountMinor: SAMPLE_FEE,
  });
}

/**
 * The cancelled competition and what it left behind, after the
 * registration seed (its students) while the institution is verified.
 * Running again changes nothing.
 */
export async function seedCancelledCompetition(deps: SeedDeps): Promise<void> {
  const [verified] = await deps.db
    .select({ status: institution.status })
    .from(institution)
    .where(eq(institution.id, SEED_INSTITUTIONS.verified.id));
  if (verified?.status !== "verified") return;
  const [there] = await deps.db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.id, SEED_CANCELLED.competitionId));
  if (there) return;
  if (!(await insertCancelledCompetition(deps))) return;
  await seedRegistrations(deps);
}
