import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  auditLog,
  competition,
  competitionAgeGroup,
  institutionRegistration,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  refund,
  registration,
} from "@/server/db/schema";
import { SEED_PAYMENTS } from "@/server/seed/payments";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { sendApprovedRefund } from "./sync-refund";
import { REASON } from "./testing";

let world: PgWorld;

beforeAll(async () => {
  world = createPgWorld();
  await world.seed.preview();
});

afterAll(async () => {
  await world.close();
});

async function staff(role: "finance" | "staff_admin") {
  const member = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(member, { role, scope: { type: "global" } });
  await world.seed.authenticator(member);
  return world.as(await world.signedIn(member, { secondFactor: true }));
}

/** A prior finance confirmation stored the real amount only on the review case. */
async function reviewedBatch(
  code: string,
  currency: string,
  amountMinor: bigint
) {
  const now = world.clock.now();
  const competitionId = randomUUID();
  const ageGroupId = randomUUID();
  const schoolId = randomUUID();
  const batchId = randomUUID();
  const caseId = randomUUID();
  const { orderId } = await world.gateway.createOrder({
    amount: { amountMinor: 100_000n, currency: "INR" },
    receipt: batchId,
    notes: {},
  });
  const { paymentId } = world.gateway.capture(orderId, {
    amount: { amountMinor, currency },
  });
  const seed = SEED_PAYMENTS.paid;
  const [school] = await world.db
    .select()
    .from(institutionRegistration)
    .where(eq(institutionRegistration.id, seed.institutionRegistrationId));
  if (!school) throw new Error("Missing seeded institution registration");
  const students = seed.students.slice(0, 2).map(({ profileOf }) => ({
    id: randomUUID(),
    participantProfileId: profileOf,
    competitionId,
    ageGroupId,
    institutionRegistrationId: schoolId,
    route: "institution" as const,
    status: "confirmed" as const,
    createdAt: now,
    updatedAt: now,
  }));
  const batch = {
    id: batchId,
    competitionId,
    institutionRegistrationId: schoolId,
    institutionId: school.institutionId,
    gateway: "fake" as const,
    gatewayOrderId: orderId,
    gatewayPaymentId: paymentId,
    captureMethod: "gateway" as const,
    route: "institution" as const,
    status: "captured" as const,
    amountMinor: 100_000n,
    createdAt: now,
    updatedAt: now,
    capturedAt: now,
  };
  await world.db.transaction(async (tx) => {
    await tx.insert(competition).values({
      id: competitionId,
      code,
      slug: code.toLowerCase(),
      name: "Reviewed receipt",
      status: "registration_closed",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(competitionAgeGroup).values({
      id: ageGroupId,
      competitionId,
      label: "Students",
      minAge: 5,
      maxAge: 18,
      position: 0,
    });
    await tx.insert(institutionRegistration).values({
      ...school,
      id: schoolId,
      competitionId,
      reference: `${code}-I-5EED2`,
    });
    await tx.insert(registration).values(students);
    await tx.insert(paymentBatch).values(batch);
    await tx.insert(paymentBatchItem).values(
      students.map(({ id }) => ({
        batchId,
        registrationId: id,
        amountMinor: 50_000n,
      }))
    );
    await tx.insert(paymentReviewCase).values({
      id: caseId,
      batchId,
      gatewayPaymentId: paymentId,
      reason: "amount_mismatch",
      amountMinor,
      currency,
      batchStatusBefore: "order_created",
      openedAt: now,
      resolvedAt: now,
      outcome: "confirm",
      resolutionReason: "Finance accepted the original receipt.",
    });
  });
  return {
    batch,
    caseId,
    paymentId,
    studentIds: students.map(({ id }) => id).sort(),
  };
}

it("rechecks a historical receipt after taking the batch lock and records a matching settlement once", async () => {
  const { batch, caseId, paymentId } = await reviewedBatch(
    "FXLOCK26",
    "USD",
    1200n
  );
  const admin = await staff("staff_admin");
  const finance = await staff("finance");
  expect(await admin.getRefundableBatch({ batchId: batch.id })).toMatchObject({
    ok: true,
    batch: {
      amountMinor: 1200n,
      currency: "USD",
      payout: { kind: "dashboard", state: "review", reviewCaseId: caseId },
    },
  });
  expect(
    await admin.requestRefund({ batchId: batch.id, reason: REASON })
  ).toEqual({
    ok: false,
    error: "dashboard_managed",
  });

  await world.db
    .update(paymentReviewCase)
    .set({ refundDue: true })
    .where(eq(paymentReviewCase.id, caseId));
  const proof = {
    id: `rfnd_${caseId}`,
    paymentId,
    amountMinor: 1200n,
    currency: "USD",
    status: "processed" as const,
    notes: {},
  };
  world.gateway.addDashboardRefund(proof);
  const record = () =>
    finance.recordDashboardRefund({ caseId, reference: proof.id });

  const { pending } = await world.sql.begin(async (blocker) => {
    await blocker`select id from payment_batch where id = ${batch.id} for update`;
    const pending = record();
    pending.catch(() => {});
    await world.waitForLockWaiters(1);
    await blocker`update payment_review_case set amount_minor = 1300 where id = ${caseId}`;
    return { pending };
  });
  expect(await pending).toEqual({ ok: false, error: "not_pending" });
  expect(await record()).toEqual({ ok: false, error: "refund_unverified" });

  const settled = { ...proof, id: `${proof.id}_correct`, amountMinor: 1300n };
  world.gateway.addDashboardRefund(settled);
  const finish = () =>
    finance.recordDashboardRefund({ caseId, reference: settled.id });
  expect(await finish()).toEqual({ ok: true });
  expect(await finish()).toEqual({ ok: false, error: "not_pending" });
  expect(await admin.getRefundableBatch({ batchId: batch.id })).toMatchObject({
    ok: true,
    batch: {
      amountMinor: 1300n,
      currency: "USD",
      payout: { kind: "dashboard", state: "recorded", reviewCaseId: caseId },
      items: [{ status: "refunded" }, { status: "refunded" }],
    },
  });
  expect(
    await world.db
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.entityId, caseId))
  ).toMatchObject([
    {
      action: "payment.dashboard_refund_recorded",
      after: {
        reference: settled.id,
        paymentId,
        amountMinor: "1300",
        currency: "USD",
      },
    },
  ]);
  expect(world.gateway.refunds).toEqual([]);
});

it("lets concurrent recordings claim the same settled provider refund only once", async () => {
  const first = await reviewedBatch("FXONCE26", "USD", 1200n);
  const second = await reviewedBatch("FXDUPE26", "USD", 1200n);
  // A legacy import can list the same receipt under two different batch IDs.
  const cases = [first, second];
  for (const { caseId } of cases) {
    await world.db
      .update(paymentReviewCase)
      .set({
        outcome: "refund",
        refundDue: true,
        gatewayPaymentId: first.paymentId,
      })
      .where(eq(paymentReviewCase.id, caseId));
  }
  const reference = `rfnd_${first.caseId}`;
  world.gateway.addDashboardRefund({
    id: reference,
    paymentId: first.paymentId,
    amountMinor: 1200n,
    currency: "USD",
    status: "processed",
    notes: {},
  });
  const finance = await staff("finance");
  const { pending } = await world.sql.begin(async (blocker) => {
    await blocker`select id from payment_batch where id in ${blocker(cases.map(({ batch }) => batch.id))} for update`;
    const pending = Promise.all(
      cases.map(({ caseId }) =>
        finance.recordDashboardRefund({ caseId, reference })
      )
    );
    pending.catch(() => {});
    await world.waitForLockWaiters(2);
    return { pending };
  });
  const outcomes = await pending;
  expect(outcomes).toEqual(
    expect.arrayContaining([
      { ok: true },
      { ok: false, error: "reference_already_recorded" },
    ])
  );
  const loser = cases[outcomes.findIndex((result) => !result.ok)]!;
  expect(
    await finance.getPaymentReviewCase({ caseId: loser.caseId })
  ).toMatchObject({
    ok: true,
    reviewCase: { resolution: { refundDue: true, manualRefund: "required" } },
  });
});

it.each([false, true])(
  "holds and releases both registrations of a one-paise whole-batch request (explicit: %s)",
  async (explicit) => {
    const { batch, studentIds } = await reviewedBatch(
      explicit ? "FXLIST26" : "FXCOVR26",
      "INR",
      1n
    );
    const admin = await staff("staff_admin");
    const finance = await staff("finance");
    const ask = () =>
      admin.requestRefund({
        batchId: batch.id,
        reason: REASON,
        ...(explicit ? { registrationIds: studentIds } : {}),
      });
    const [zeroShare] = studentIds;

    const { requests } = await world.sql.begin(async (blocker) => {
      await blocker`select id from payment_batch where id = ${batch.id} for update`;
      const requests = Promise.all([ask(), ask()]);
      requests.catch(() => {});
      await world.waitForLockWaiters(2);
      return { requests };
    });
    const outcomes = await requests;
    expect(outcomes).toHaveLength(2);
    expect(outcomes).toContainEqual(
      explicit
        ? { ok: false, error: "item_in_live_refund", registrationId: zeroShare }
        : { ok: false, error: "nothing_to_refund" }
    );
    const held = outcomes.find((result) => result.ok);
    if (!held) throw new Error("Refund request was refused");
    expect(held).toMatchObject({
      amountMinor: 1n,
      registrationIds: studentIds,
    });
    expect(
      await admin.requestRefund({
        batchId: batch.id,
        registrationIds: [zeroShare!],
        reason: REASON,
      })
    ).toEqual({
      ok: false,
      error: "item_in_live_refund",
      registrationId: zeroShare,
    });
    expect(
      await finance.rejectRefund({ refundId: held.refundId, note: REASON })
    ).toEqual({ ok: true, status: "rejected" });
    expect(await ask()).toMatchObject({
      ok: true,
      amountMinor: 1n,
      registrationIds: studentIds,
    });
  }
);

it("revalidates an unsent whole approval under the batch lock and preserves the settled balance", async () => {
  const { batch, caseId, paymentId, studentIds } = await reviewedBatch(
    "FXAMT26",
    "INR",
    160_000n
  );
  const admin = await staff("staff_admin");
  const finance = await staff("finance");
  await world.db
    .update(paymentReviewCase)
    .set({ amountMinor: 140_000n })
    .where(eq(paymentReviewCase.id, caseId));
  const send = (refundId: string) =>
    sendApprovedRefund(
      {
        db: world.db,
        clock: world.clock,
        payments: world.gateway,
      },
      { refundId }
    );
  const first = await admin.requestRefund({
    batchId: batch.id,
    registrationIds: [studentIds[0]!],
    reason: REASON,
  });
  expect(first).toMatchObject({ ok: true, amountMinor: 70_000n });
  if (!first.ok) throw new Error("Missing partial refund");
  expect(await finance.approveRefund({ refundId: first.refundId })).toEqual({
    ok: true,
    status: "approved",
  });
  await send(first.refundId);
  expect(await finance.getRefund({ refundId: first.refundId })).toMatchObject({
    ok: true,
    refund: { status: "refunded", amountMinor: 70_000n },
  });

  const ask = () => admin.requestRefund({ batchId: batch.id, reason: REASON });
  const stale = await ask();
  expect(stale).toMatchObject({ ok: true, amountMinor: 70_000n });
  if (!stale.ok) throw new Error("Missing whole refund");
  expect(await finance.approveRefund({ refundId: stale.refundId })).toEqual({
    ok: true,
    status: "approved",
  });
  const { pending } = await world.sql.begin(async (blocker) => {
    await blocker`select id from payment_batch where id = ${batch.id} for update`;
    const pending = send(stale.refundId);
    pending.catch(() => {});
    await world.waitForLockWaiters(1);
    await blocker`update payment_review_case set amount_minor = 160000 where id = ${caseId}`;
    return { pending };
  });
  await pending;
  expect(await finance.getRefund({ refundId: stale.refundId })).toMatchObject({
    ok: true,
    refund: { status: "failed", amountMinor: 70_000n, gatewayRefundId: null },
  });
  expect(
    world.gateway.refunds.filter((row) => row.paymentId === paymentId)
  ).toEqual([expect.objectContaining({ amountMinor: 70_000n })]);
  expect(
    await finance.rejectRefund({ refundId: stale.refundId, note: REASON })
  ).toEqual({ ok: true, status: "rejected" });
  const replacement = await ask();
  expect(replacement).toMatchObject({
    ok: true,
    amountMinor: 90_000n,
    registrationIds: [studentIds[1]],
  });
  if (!replacement.ok) throw new Error("Missing replacement refund");
  expect(
    await finance.approveRefund({ refundId: replacement.refundId })
  ).toEqual({
    ok: true,
    status: "approved",
  });
  await send(replacement.refundId);
  expect(
    world.gateway.refunds.filter((row) => row.paymentId === paymentId)
  ).toEqual([
    expect.objectContaining({ amountMinor: 70_000n }),
    expect.objectContaining({ amountMinor: 90_000n }),
  ]);
});

it("rolls back the whole request and names the student claimed by another transaction", async () => {
  const {
    batch,
    studentIds: [first, taken],
  } = await reviewedBatch("FXRACE26", "INR", 40_001n);
  const now = world.clock.now();
  const otherBatchId = randomUUID();
  const otherRefundId = randomUUID();
  const admin = await staff("staff_admin");
  await world.db.insert(paymentBatch).values({
    ...batch,
    id: otherBatchId,
    status: "cancelled",
    amountMinor: 50_000n,
    gatewayOrderId: null,
    gatewayPaymentId: null,
    captureMethod: null,
    capturedAt: null,
  });
  await world.db.insert(paymentBatchItem).values({
    batchId: otherBatchId,
    registrationId: taken!,
    amountMinor: 50_000n,
    releasedAt: now,
  });
  await world.db.insert(refund).values({
    id: otherRefundId,
    batchId: otherBatchId,
    kind: "discretionary",
    status: "approved",
    method: "manual",
    amountMinor: 50_000n,
    reason: REASON,
    requestedAt: now,
    updatedAt: now,
  });
  const { pending } = await world.sql.begin(async (blocker) => {
    await blocker`insert into refund_item (refund_id, batch_id, registration_id, amount_minor)
      values (${otherRefundId}, ${otherBatchId}, ${taken!}, 50000)`;
    const pending = admin.requestRefund({ batchId: batch.id, reason: REASON });
    pending.catch(() => {});
    await world.waitForLockWaiters(1);
    return { pending };
  });
  expect(await pending).toEqual({
    ok: false,
    error: "item_in_live_refund",
    registrationId: taken,
  });
  expect(await admin.getRefundableBatch({ batchId: batch.id })).toMatchObject({
    ok: true,
    batch: { amountMinor: 40_001n, currency: "INR", refunds: [] },
  });
  expect(
    await admin.requestRefund({
      batchId: batch.id,
      reason: REASON,
      registrationIds: [first!],
    })
  ).toMatchObject({
    ok: true,
    amountMinor: 20_000n,
    registrationIds: [first],
  });
});
