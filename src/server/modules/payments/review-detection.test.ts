import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, gatewayWebhookEvent } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  batchRow,
  closeRegistration,
  enrol,
  openOrder,
  paymentRows,
  registrationsOf,
  reviewCasesOf,
  schoolWithStudents,
  signInStaff,
  uploadProof,
  type School,
} from "./testing";

// #79: money the gateway captured that a batch can't accept. However the
// news arrives (a webhook, the Checkout return, paying again), the batch
// moves to needs_review, one review case opens per payment, nothing is
// confirmed that wasn't, and nothing is refunded: the gateway still holds
// the payment as captured.

const receive = (h: Harness, orderId: string) =>
  h
    .as(h.visitor())
    .receiveGatewayWebhook(
      h.gateway.webhook({ type: "payment.captured", orderId })
    );

/** The order's payments as the gateway holds them: none refunded. */
async function gatewayStatuses(h: Harness, orderId: string) {
  return (await h.gateway.fetchOrderPayments(orderId)).map((p) => p.status);
}

async function webhookOutcomes(h: Harness) {
  return (await h.db.select().from(gatewayWebhookEvent)).map(
    (row) => row.outcome
  );
}

/** A school of `students`, its coordinator replacing its first batch by
 * enrolling one more and paying again. */
async function supersededBatch(h: Harness, students = 1) {
  const school = await schoolWithStudents(h, { students });
  const first = await openOrder(school);
  school.registrationIds.push(await enrol(h, school, students + 1));
  const second = await openOrder(school);
  return { school, first, second };
}

async function reviewAudit(h: Harness, caseId: string) {
  return h.db
    .select({ action: auditLog.action, after: auditLog.after })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityId, caseId),
        eq(auditLog.action, "payment.review_opened")
      )
    );
}

async function expectOneCase(
  h: Harness,
  batchId: string,
  expected: {
    reason: string;
    gatewayPaymentId: string;
    batchStatusBefore: string;
  }
) {
  const cases = await reviewCasesOf(h, batchId);
  expect(cases).toEqual([
    expect.objectContaining({
      ...expected,
      openedAt: h.clock.now(),
      resolvedAt: null,
      outcome: null,
      refundDue: false,
    }),
  ]);
  expect(await reviewAudit(h, cases[0]!.id)).toEqual([
    {
      action: "payment.review_opened",
      after: expect.objectContaining({
        batchId,
        reason: expected.reason,
        gatewayPaymentId: expected.gatewayPaymentId,
        batchStatusBefore: expected.batchStatusBefore,
      }),
    },
  ]);
  return cases[0]!;
}

describe("a capture the batch can't accept", () => {
  it("(a) on a replaced batch whose students another payment confirmed: already paid", async () => {
    const h = await createHarness();
    const { school, first, second } = await supersededBatch(h);
    h.gateway.capture(second.orderId);
    await receive(h, second.orderId);
    const confirmed = await registrationsOf(h, school.registrationIds);
    const { paymentId } = h.gateway.capture(first.orderId);

    const result = await receive(h, first.orderId);

    expect(result).toEqual({ ok: true, outcome: "needs_review" });
    expect((await batchRow(h, first.batchId)).status).toBe("needs_review");
    await expectOneCase(h, first.batchId, {
      reason: "already_paid",
      gatewayPaymentId: paymentId,
      batchStatusBefore: "cancelled",
    });
    expect(await registrationsOf(h, school.registrationIds)).toEqual(confirmed);
    expect(await gatewayStatuses(h, first.orderId)).toEqual(["captured"]);
  });

  it("(b) holding a student withdrawn while the order was open: registration cancelled", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    await h.as(school.coordinator.actor).withdrawStudent({
      ...school.ids,
      registrationId: school.registrationIds[0]!,
    });
    const { paymentId } = h.gateway.capture(orderId);

    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });

    await expectOneCase(h, batchId, {
      reason: "registration_cancelled",
      gatewayPaymentId: paymentId,
      batchStatusBefore: "order_created",
    });
    const statuses = new Map(
      (await registrationsOf(h, school.registrationIds)).map((r) => [
        r.id,
        r.status,
      ])
    );
    expect(statuses.get(school.registrationIds[0]!)).toBe("withdrawn");
    expect(statuses.get(school.registrationIds[1]!)).toBe("enrolled");
    expect(await gatewayStatuses(h, orderId)).toEqual(["captured"]);
  });

  it("(c) after the competition stopped taking registrations: registration closed", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    await closeRegistration(h, school);
    const { paymentId } = h.gateway.capture(orderId);

    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });

    await expectOneCase(h, batchId, {
      reason: "registration_closed",
      gatewayPaymentId: paymentId,
      batchStatusBefore: "order_created",
    });
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["enrolled", "enrolled"]);
  });

  it("(d) on a batch already paid offline: already paid, and its students stay confirmed", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    const finance = await signInStaff(h, "finance");
    const proofFileId = await uploadProof(h, finance.actor, batchId);
    await h.as(finance.actor).recordOfflinePayment({
      batchId,
      method: "bank_transfer",
      reference: "AXIS202701145555",
      amount: "1000",
      receivedOn: "2027-01-15",
      proofFileId,
    });
    const confirmed = await registrationsOf(h, school.registrationIds);
    const { paymentId } = h.gateway.capture(orderId);

    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });

    await expectOneCase(h, batchId, {
      reason: "already_paid",
      gatewayPaymentId: paymentId,
      batchStatusBefore: "captured",
    });
    expect(await batchRow(h, batchId)).toMatchObject({
      status: "needs_review",
      captureMethod: "offline",
    });
    expect(await registrationsOf(h, school.registrationIds)).toEqual(confirmed);
    expect(await gatewayStatuses(h, orderId)).toEqual(["captured"]);
  });

  it("(e) paid twice on one order: captured for the first payment, a case for the second", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    const firstPayment = h.gateway.capture(orderId).paymentId;
    const secondPayment = h.gateway.capture(orderId).paymentId;

    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "captured",
    });

    expect(await batchRow(h, batchId)).toMatchObject({
      status: "needs_review",
      gatewayPaymentId: firstPayment,
      captureMethod: "gateway",
    });
    await expectOneCase(h, batchId, {
      reason: "already_paid",
      gatewayPaymentId: secondPayment,
      batchStatusBefore: "captured",
    });
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["confirmed", "confirmed"]);
    expect(await gatewayStatuses(h, orderId)).toEqual(["captured", "captured"]);
  });

  it("(e) a second payment after the batch was captured also opens a case", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    h.gateway.capture(orderId);
    await receive(h, orderId);
    const { paymentId } = h.gateway.capture(orderId);

    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });

    await expectOneCase(h, batchId, {
      reason: "already_paid",
      gatewayPaymentId: paymentId,
      batchStatusBefore: "captured",
    });
  });

  it("(f) for an amount that isn't the batch's: amount mismatch, as well as 77a's audit entry", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    const { paymentId } = h.gateway.capture(orderId, {
      amount: { amountMinor: 50_000n, currency: "INR" },
    });

    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });

    const opened = await expectOneCase(h, batchId, {
      reason: "amount_mismatch",
      gatewayPaymentId: paymentId,
      batchStatusBefore: "order_created",
    });
    expect(opened).toMatchObject({ amountMinor: 50_000n, currency: "INR" });
    expect(
      await h.db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.action, "payment.amount_mismatch"))
    ).toHaveLength(1);
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["enrolled", "enrolled"]);
  });

  it("(g) on a replaced batch whose students a newer, unpaid batch holds: batch superseded", async () => {
    const h = await createHarness();
    const { school, first, second } = await supersededBatch(h);
    const { paymentId } = h.gateway.capture(first.orderId);

    expect(await receive(h, first.orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });

    await expectOneCase(h, first.batchId, {
      reason: "batch_superseded",
      gatewayPaymentId: paymentId,
      batchStatusBefore: "cancelled",
    });
    expect((await batchRow(h, second.batchId)).status).toBe("order_created");
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["enrolled", "enrolled"]);
  });
});

describe("a payment in review", () => {
  it("opens one case however often, and by whichever signal, the news arrives", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    await closeRegistration(h, school);
    const checkout = h.gateway.capture(orderId);
    const webhook = h.gateway.webhook({ type: "payment.captured", orderId });
    await h.as(h.visitor()).receiveGatewayWebhook(webhook);
    const after = await paymentRows(h);

    // The same webhook again, another about the order, the Checkout return.
    expect(await h.as(h.visitor()).receiveGatewayWebhook(webhook)).toEqual({
      ok: true,
      outcome: "duplicate",
    });
    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });
    expect(
      await h.as(school.coordinator.actor).confirmCheckout({
        institutionId: school.institutionId,
        batchId,
        ...checkout,
      })
    ).toEqual({ ok: true, outcome: "needs_review" });

    const now = await paymentRows(h);
    expect(now.reviewCases).toEqual(after.reviewCases);
    expect(now.batches).toEqual(after.batches);
    expect(now.registrations).toEqual(after.registrations);
    // No new audit entry for the signals that changed nothing (77a r2).
    expect(now.audit).toEqual(after.audit);
    expect(await webhookOutcomes(h)).toEqual(["needs_review", "needs_review"]);
  });

  it("keeps its students: paying again opens no second order while staff decide", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { orderId } = await openOrder(school);
    h.gateway.capture(orderId, {
      amount: { amountMinor: 1n, currency: "INR" },
    });
    await receive(h, orderId);
    const orders = h.gateway.orders.length;

    expect(await school.pay()).toEqual({ ok: false, error: "nothing_to_pay" });
    expect(h.gateway.orders).toHaveLength(orders);
  });

  it("takes a second payment as another case, copying where the batch stood", async () => {
    const h = await createHarness();
    const school: School = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    h.gateway.capture(orderId, {
      amount: { amountMinor: 1n, currency: "INR" },
    });
    await receive(h, orderId);
    const { paymentId } = h.gateway.capture(orderId);

    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });

    const cases = await reviewCasesOf(h, batchId);
    expect(cases.map((each) => [each.reason, each.batchStatusBefore])).toEqual([
      ["amount_mismatch", "order_created"],
      ["already_paid", "order_created"],
    ]);
    expect(cases[1]?.gatewayPaymentId).toBe(paymentId);
    expect((await batchRow(h, batchId)).status).toBe("needs_review");
  });
});
