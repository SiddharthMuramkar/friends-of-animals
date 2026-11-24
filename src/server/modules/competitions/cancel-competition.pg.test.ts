import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  competition,
  competitionAgeGroup,
  institutionRegistration,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  refund,
  refundItem,
  registration,
} from "@/server/db/schema";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import { SEED_PAYMENTS } from "@/server/seed/payments";
import { SEED_REFUNDS } from "@/server/seed/refunds";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;

beforeAll(async () => {
  world = createPgWorld();
  await world.seed.preview();
});

afterAll(async () => {
  await world.close();
});

async function staffForCancellation() {
  const finance = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(finance, {
    role: "finance",
    scope: { type: "global" },
  });
  await world.seed.authenticator(finance);
  const admin = await world.seed.superAdmin({ email: world.uniqueEmail() });
  await world.seed.authenticator(admin);
  const decider = world.as(
    await world.signedIn(finance, { secondFactor: true })
  );
  const canceller = world.as(
    await world.signedIn(admin, { secondFactor: true })
  );
  return { decider, canceller };
}

it("queues the remaining items when finance approves a partial refund during cancellation", async () => {
  const { decider, canceller } = await staffForCancellation();
  const { batchId, competitionId, students } = SEED_PAYMENTS.paid;
  const { refundId } = SEED_REFUNDS.requested;

  // Queue finance first. Cancellation starts while the request is still
  // visible as requested, and waits for that same refund row.
  const { approving, cancelling } = await world.sql.begin(async (blocker) => {
    await blocker`select id from refund where id = ${refundId} for update`;
    const approving = decider.approveRefund({ refundId });
    approving.catch(() => {});
    await world.waitForLockWaiters(1);
    const cancelling = canceller.cancelCompetition({
      competitionId,
      reason: "The venue is closed.",
    });
    cancelling.catch(() => {});
    await world.waitForLockWaiters(2);
    return { approving, cancelling };
  });

  expect(await approving).toEqual({ ok: true, status: "approved" });
  expect(await cancelling).toEqual({ ok: true, status: "cancelled" });
  const holds = await world.db
    .select({
      registrationId: refundItem.registrationId,
      kind: refund.kind,
      status: refund.status,
    })
    .from(refundItem)
    .innerJoin(refund, eq(refundItem.refundId, refund.id))
    .where(and(eq(refundItem.batchId, batchId), isNull(refundItem.releasedAt)))
    .orderBy(refundItem.registrationId);
  expect(holds).toEqual([
    {
      registrationId: students[0].registrationId,
      kind: "discretionary",
      status: "approved",
    },
    {
      registrationId: students[1].registrationId,
      kind: "cancellation",
      status: "approved",
    },
    {
      registrationId: students[2].registrationId,
      kind: "cancellation",
      status: "approved",
    },
  ]);
});

async function waitingForReview(code: string) {
  const now = world.clock.now();
  const competitionId = randomUUID();
  const institutionRegistrationId = randomUUID();
  const ageGroupId = randomUUID();
  const batchId = randomUUID();
  const caseId = randomUUID();
  // The unrelated registration sorts first in cancellation's row scan.
  const unrelatedId = `10000000${randomUUID().slice(8)}`;
  const studentId = `20000000${randomUUID().slice(8)}`;
  const seed = SEED_PAYMENTS.paid;
  const [school] = await world.db
    .select()
    .from(institutionRegistration)
    .where(eq(institutionRegistration.id, seed.institutionRegistrationId));
  if (!school) throw new Error("Missing seeded institution registration");
  await world.db.insert(competition).values({
    id: competitionId,
    code,
    slug: code.toLowerCase(),
    name: "Reviewed payment race",
    status: "registration_closed",
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await world.db.insert(competitionAgeGroup).values({
    id: ageGroupId,
    competitionId,
    label: "Students",
    minAge: 5,
    maxAge: 18,
    position: 0,
  });
  await world.db.insert(institutionRegistration).values({
    ...school,
    id: institutionRegistrationId,
    competitionId,
    reference: `${code}-I-5EED2`,
  });
  await world.db.insert(registration).values(
    [
      { id: unrelatedId, participantProfileId: seed.students[0]!.profileOf },
      { id: studentId, participantProfileId: seed.students[1]!.profileOf },
    ].map((student) => ({
      ...student,
      competitionId,
      ageGroupId,
      institutionRegistrationId,
      route: "institution" as const,
      status: "enrolled" as const,
      createdAt: now,
      updatedAt: now,
    }))
  );
  await world.db.insert(paymentBatch).values({
    id: batchId,
    competitionId,
    institutionRegistrationId,
    institutionId: school.institutionId,
    gateway: "fake",
    gatewayOrderId: `order_${code}`,
    route: "institution",
    status: "needs_review",
    amountMinor: 50_000n,
    createdAt: now,
    updatedAt: now,
  });
  await world.db
    .insert(paymentBatchItem)
    .values({ batchId, registrationId: studentId, amountMinor: 50_000n });
  await world.db.insert(paymentReviewCase).values({
    id: caseId,
    batchId,
    gatewayPaymentId: `pay_${code}`,
    reason: "amount_mismatch",
    amountMinor: 49_900n,
    currency: "INR",
    batchStatusBefore: "order_created",
    openedAt: now,
  });
  return { competitionId, unrelatedId, studentId, batchId, caseId };
}

const REASON = "The venue is closed for the season.";

it("cancels an open individual order while the payer resumes checkout", async () => {
  const { canceller } = await staffForCancellation();
  const target = await openToIndividuals(world, { code: "PAYRCE27" });
  const owner = await world.seed.member({ email: world.uniqueEmail() });
  const payer = world.as(await world.signedIn(owner));
  const registered = await payer.registerAsIndividual(adultForm(target));
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  const checkout = () =>
    payer.payForMyRegistration({ registrationId: registered.registrationId });
  const opened = await checkout();
  if (!opened.ok || opened.kind !== "checkout")
    throw new Error(JSON.stringify(opened));

  const { cancelling, resuming } = await world.sql.begin(async (blocker) => {
    await blocker`select id from payment_batch where id = ${opened.batchId} for update`;
    const cancelling = canceller.cancelCompetition({
      competitionId: target.id,
      reason: REASON,
    });
    cancelling.catch(() => {});
    await world.waitForLockWaiters(1);
    const resuming = checkout();
    resuming.catch(() => {});
    await world.waitForLockWaiters(2);
    return { cancelling, resuming };
  });

  await expect(cancelling).resolves.toEqual({ ok: true, status: "cancelled" });
  await expect(resuming).resolves.toEqual({
    ok: false,
    error: "nothing_to_pay",
  });
  expect(await payer.listMyRegistrations()).toMatchObject([
    { status: "cancelled" },
  ]);
});

it("queues the refund for a reviewed payment when confirmation commits first", async () => {
  const { decider, canceller } = await staffForCancellation();
  const { competitionId, unrelatedId, studentId, batchId, caseId } =
    await waitingForReview("RACE27");

  const { confirmed, cancelling } = await world.sql.begin(
    async (registrationBlocker) => {
      await registrationBlocker`select id from registration where id = ${unrelatedId} for update`;
      const { confirming, cancelling } = await world.sql.begin(
        async (caseBlocker) => {
          await caseBlocker`select id from payment_review_case where id = ${caseId} for update`;
          const confirming = decider.resolvePaymentReviewCase({
            caseId,
            outcome: "confirm",
            reason: REASON,
          });
          confirming.catch(() => {});
          await world.waitForLockWaiters(1);
          const cancelling = canceller.cancelCompetition({
            competitionId,
            reason: REASON,
          });
          cancelling.catch(() => {});
          await world.waitForLockWaiters(2);
          return { confirming, cancelling };
        }
      );
      return { confirmed: await confirming, cancelling };
    }
  );

  expect(confirmed).toEqual({ ok: true, batchStatus: "captured" });
  expect(await cancelling).toEqual({ ok: true, status: "cancelled" });
  const items = await world.db
    .select({
      registrationId: refundItem.registrationId,
      amountMinor: refund.amountMinor,
      kind: refund.kind,
      status: refund.status,
    })
    .from(refundItem)
    .innerJoin(refund, eq(refund.id, refundItem.refundId))
    .where(eq(refund.batchId, batchId));
  expect(items).toEqual([
    {
      registrationId: studentId,
      amountMinor: 49_900n,
      kind: "cancellation",
      status: "approved",
    },
  ]);
});

it("leaves the payment available for finance to refund when cancellation commits first", async () => {
  const { decider, canceller } = await staffForCancellation();
  const { competitionId, unrelatedId, studentId, batchId, caseId } =
    await waitingForReview("RACE28");
  const { confirming, cancelling } = await world.sql.begin(
    async (registrationBlocker) => {
      await registrationBlocker`select id from registration where id = ${unrelatedId} for update`;
      const cancelling = canceller.cancelCompetition({
        competitionId,
        reason: REASON,
      });
      cancelling.catch(() => {});
      await world.waitForLockWaiters(1);
      const confirming = decider.resolvePaymentReviewCase({
        caseId,
        outcome: "confirm",
        reason: REASON,
      });
      confirming.catch(() => {});
      await Promise.race([world.waitForLockWaiters(2), confirming]);
      return { confirming, cancelling };
    }
  );

  expect(await cancelling).toEqual({ ok: true, status: "cancelled" });
  expect(await confirming).toEqual({
    ok: false,
    error: "registration_not_payable",
  });
  expect(await decider.getPaymentReviewCase({ caseId })).toMatchObject({
    reviewCase: { allowedOutcomes: ["refund", "keep"], resolution: null },
  });
  expect(
    await world.db
      .select({ status: registration.status })
      .from(registration)
      .where(eq(registration.id, studentId))
  ).toEqual([{ status: "cancelled" }]);
  expect(
    await decider.resolvePaymentReviewCase({
      caseId,
      outcome: "refund",
      reason: REASON,
    })
  ).toEqual({ ok: true, batchStatus: "cancelled" });
  expect(
    await world.db
      .select({
        amountMinor: refund.amountMinor,
        kind: refund.kind,
        status: refund.status,
      })
      .from(refund)
      .where(eq(refund.batchId, batchId))
  ).toEqual([{ amountMinor: 49_900n, kind: "duplicate", status: "approved" }]);
});
