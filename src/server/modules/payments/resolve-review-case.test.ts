import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, outbox, paymentBatchItem, user } from "@/server/db/schema";
import { REGISTRATION_NUMBER } from "@/server/modules/registration/domain/registration-number";
import { createHarness, type Harness } from "@/test/harness";

import {
  adultForm,
  openToIndividuals,
  signInMember,
} from "../participants/testing";
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
  type PaymentsStaffRole,
  type School,
} from "./testing";

// #79: staff list the payments needing review and resolve each with an
// outcome and a reason. Confirming accepts the money through the capture
// path; refunding marks the payment for the refunds ticket (#80) and calls
// no gateway; keeping moves no money.

const REASON = "The school's bursar confirmed the payment by phone.";

const receive = (h: Harness, orderId: string) =>
  h
    .as(h.visitor())
    .receiveGatewayWebhook(
      h.gateway.webhook({ type: "payment.captured", orderId })
    );

/** A school of two whose payment arrived after registration closed. */
async function closedCase(h: Harness, name = "Test School") {
  const school = await schoolWithStudents(h, { students: 2, name });
  const { batchId, orderId } = await openOrder(school);
  await closeRegistration(h, school);
  const { paymentId } = h.gateway.capture(orderId);
  await receive(h, orderId);
  const [opened] = await reviewCasesOf(h, batchId);
  if (!opened) throw new Error("no case");
  return { school, batchId, orderId, paymentId, caseId: opened.id };
}

/** A school of two that paid ₹1 short. */
async function mismatchCase(h: Harness, code = "PAWS27") {
  const school = await schoolWithStudents(h, { students: 2, code });
  const { batchId, orderId } = await openOrder(school);
  const { paymentId } = h.gateway.capture(orderId, {
    amount: { amountMinor: 99_900n, currency: "INR" },
  });
  await receive(h, orderId);
  const [opened] = await reviewCasesOf(h, batchId);
  if (!opened) throw new Error("no case");
  return { school, batchId, orderId, paymentId, caseId: opened.id };
}

/** A school of two paid by cheque, then paid again through the gateway. */
async function paidTwiceCase(h: Harness) {
  const school = await schoolWithStudents(h, { students: 2 });
  const { batchId, orderId } = await openOrder(school);
  const finance = await signInStaff(h, "finance");
  const proofFileId = await uploadProof(h, finance.actor, batchId);
  await h.as(finance.actor).recordOfflinePayment({
    batchId,
    method: "cheque",
    reference: "004512",
    amount: "1000",
    receivedOn: "2027-01-15",
    proofFileId,
  });
  const { paymentId } = h.gateway.capture(orderId);
  await receive(h, orderId);
  const [opened] = await reviewCasesOf(h, batchId);
  if (!opened) throw new Error("no case");
  return { school, batchId, orderId, paymentId, caseId: opened.id };
}

async function heldBy(h: Harness, batchId: string) {
  return h.db
    .select({ registrationId: paymentBatchItem.registrationId })
    .from(paymentBatchItem)
    .where(
      and(
        eq(paymentBatchItem.batchId, batchId),
        isNull(paymentBatchItem.releasedAt)
      )
    );
}

describe("listPaymentReviewCases", () => {
  it("lists open cases newest first, with the payer, reason, amount and when it opened", async () => {
    const h = await createHarness();
    const older = await closedCase(h, "Banyan School");
    h.clock.advance({ minutes: 3 });
    const newer = await mismatchCase(h, "KITE27");
    const finance = await signInStaff(h, "finance");

    const result = await h
      .as(finance.actor)
      .listPaymentReviewCases({ state: "open" });

    expect(result).toEqual({
      ok: true,
      cases: [
        expect.objectContaining({
          id: newer.caseId,
          batchId: newer.batchId,
          reason: "amount_mismatch",
          amountMinor: 99_900n,
          currency: "INR",
          payer: { kind: "institution", name: "Test School" },
          competitionName: "Competition KITE27",
          resolution: null,
        }),
        expect.objectContaining({
          id: older.caseId,
          batchId: older.batchId,
          reason: "registration_closed",
          amountMinor: 100_000n,
          payer: { kind: "institution", name: "Banyan School" },
          resolution: null,
        }),
      ],
    });
    if (result.ok) {
      expect(result.cases[1]?.openedAt.getTime()).toBeLessThan(
        result.cases[0]!.openedAt.getTime()
      );
    }
  });

  it("names the adult who paid for their own registration", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h, { code: "NEIGH27" });
    const ravi = await signInMember(h, { name: "Ravi Kumar" });
    const registered = await h
      .as(ravi.actor)
      .registerAsIndividual(adultForm(competition, { fullName: "Ravi Kumar" }));
    if (!registered.ok) throw new Error("not registered");
    const paying = await h
      .as(ravi.actor)
      .payForMyRegistration({ registrationId: registered.registrationId });
    if (!paying.ok || paying.kind !== "checkout") throw new Error("no order");
    h.gateway.capture(paying.checkout.orderId, {
      amount: { amountMinor: 1n, currency: "INR" },
    });
    await receive(h, paying.checkout.orderId);
    const finance = await signInStaff(h, "finance");

    const result = await h
      .as(finance.actor)
      .listPaymentReviewCases({ state: "open" });

    expect(result).toMatchObject({
      ok: true,
      cases: [{ payer: { kind: "person", name: "Ravi Kumar" } }],
    });
  });

  it("lists resolved cases apart, with how and when each was resolved", async () => {
    const h = await createHarness();
    const open = await closedCase(h);
    const resolved = await mismatchCase(h, "KITE27");
    const finance = await signInStaff(h, "finance");
    await h.as(finance.actor).resolvePaymentReviewCase({
      caseId: resolved.caseId,
      outcome: "refund",
      reason: REASON,
    });

    const result = await h
      .as(finance.actor)
      .listPaymentReviewCases({ state: "resolved" });

    expect(result).toEqual({
      ok: true,
      cases: [
        expect.objectContaining({
          id: resolved.caseId,
          resolution: {
            outcome: "refund",
            resolvedAt: h.clock.now(),
            refundDue: true,
          },
        }),
      ],
    });
    expect(
      await h.as(finance.actor).listPaymentReviewCases({ state: "open" })
    ).toMatchObject({ cases: [{ id: open.caseId }] });
  });
});

describe("getPaymentReviewCase", () => {
  it("shows a case with what staff may choose for it", async () => {
    const h = await createHarness();
    const { caseId, batchId, paymentId } = await closedCase(h);
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).getPaymentReviewCase({ caseId })
    ).toMatchObject({
      ok: true,
      reviewCase: {
        id: caseId,
        batchId,
        reason: "registration_closed",
        gatewayPaymentId: paymentId,
        batchStatus: "needs_review",
        batchStatusBefore: "order_created",
        batchAmountMinor: 100_000n,
        allowedOutcomes: ["confirm", "refund", "keep"],
        otherOpenCases: 0,
        resolution: null,
      },
    });
  });

  it("says when there's no such case", async () => {
    const h = await createHarness();
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).getPaymentReviewCase({
        caseId: "01938a00-0000-7000-8000-00000000dead",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("resolvePaymentReviewCase", () => {
  it("leaves a foreign-currency payment in review for a dashboard refund", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    h.gateway.capture(orderId, {
      amount: { amountMinor: 1200n, currency: "USD" },
    });
    expect(await receive(h, orderId)).toEqual({
      ok: true,
      outcome: "needs_review",
    });
    const [opened] = await reviewCasesOf(h, batchId);
    if (!opened) throw new Error("No payment review case");
    const finance = h.as((await signInStaff(h, "finance")).actor);
    const decide = (outcome: "confirm" | "refund") =>
      finance.resolvePaymentReviewCase({
        caseId: opened.id,
        outcome,
        reason: REASON,
      });
    expect(await decide("confirm")).toEqual({
      ok: false,
      error: "outcome_not_allowed",
    });
    expect(
      await finance.getPaymentReviewCase({ caseId: opened.id })
    ).toMatchObject({
      reviewCase: { currency: "USD", allowedOutcomes: ["refund", "keep"] },
    });
    expect(await decide("refund")).toEqual({
      ok: true,
      batchStatus: "cancelled",
      manualRefundRequired: { currency: "USD" },
    });
    await h.drain();
    expect(h.gateway.refunds).toEqual([]);
  });

  it("confirms money that arrived after the close: the batch is captured and each student confirmed", async () => {
    const h = await createHarness();
    const { school, batchId, paymentId, caseId } = await closedCase(h);
    const finance = await signInStaff(h, "finance");

    const result = await h.as(finance.actor).resolvePaymentReviewCase({
      caseId,
      outcome: "confirm",
      reason: `  ${REASON}  `,
    });

    expect(result).toEqual({ ok: true, batchStatus: "captured" });
    expect(await batchRow(h, batchId)).toMatchObject({
      status: "captured",
      captureMethod: "gateway",
      gatewayPaymentId: paymentId,
      capturedAt: h.clock.now(),
    });
    const registrations = await registrationsOf(h, school.registrationIds);
    for (const row of registrations) {
      expect(row.status).toBe("confirmed");
      expect(row.registrationNumber).toMatch(REGISTRATION_NUMBER);
    }
    expect(await reviewCasesOf(h, batchId)).toEqual([
      expect.objectContaining({
        outcome: "confirm",
        resolutionReason: REASON,
        resolvedByUserId: finance.userId,
        resolvedAt: h.clock.now(),
        refundDue: false,
      }),
    ]);
    const [resolved] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "payment.review_resolved"));
    expect(resolved).toMatchObject({
      actorRole: "finance",
      entityType: "payment_review_case",
      entityId: caseId,
      before: { outcome: null, batchStatus: "needs_review" },
      after: {
        outcome: "confirm",
        refundDue: false,
        batchId,
        batchStatus: "captured",
      },
    });
    expect(
      (
        await h.db
          .selectDistinct({ eventId: outbox.eventId })
          .from(outbox)
          .where(eq(outbox.eventType, "payment.batch_captured"))
      ).length
    ).toBe(1);
  });

  it("keeps the payer while a payment review is open, then expires from the resolution", async () => {
    const h = await createHarness();
    const { school, batchId, caseId } = await closedCase(h);
    await h.settings.set("retention.enforce", true);
    const worker = h.as({ kind: "system", process: "worker" });
    const payerId = school.coordinator.userId;
    const [payer] = await h.db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, payerId));
    expect(payer?.email).toEqual(expect.any(String));
    h.clock.set("2041-05-01T00:00:00Z");

    expect(
      (await worker.runRetentionSweep()).policies.financialRecords?.anonymised
    ).toBe(0);
    expect(await batchRow(h, batchId)).toMatchObject({
      status: "needs_review",
      payerUserId: payerId,
    });

    const finance = await signInStaff(h, "finance");
    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId,
        outcome: "confirm",
        reason: REASON,
      })
    ).toEqual({ ok: true, batchStatus: "captured" });
    const mark = h.email.sent.length;
    await h.drain();
    expect(h.email.sent.slice(mark)).toContainEqual(
      expect.objectContaining({
        to: payer?.email,
        subject: expect.stringMatching(/^Payment received for /),
      })
    );

    h.clock.set("2050-03-31T18:29:59Z");
    await worker.runRetentionSweep();
    expect(await batchRow(h, batchId)).toMatchObject({ payerUserId: payerId });
    h.clock.advance({ seconds: 1 });
    expect(
      (await worker.runRetentionSweep()).policies.financialRecords?.anonymised
    ).toBe(1);
    expect(await batchRow(h, batchId)).toMatchObject({
      status: "captured",
      payerUserId: null,
    });
  });

  it("confirms a replaced batch's money: the newer, unpaid batch is cancelled and lets its students go", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const first = await openOrder(school);
    school.registrationIds.push(await enrol(h, school, 2));
    const second = await openOrder(school);
    h.gateway.capture(first.orderId);
    await receive(h, first.orderId);
    const [opened] = await reviewCasesOf(h, first.batchId);
    const finance = await signInStaff(h, "finance");

    const result = await h.as(finance.actor).resolvePaymentReviewCase({
      caseId: opened!.id,
      outcome: "confirm",
      reason: REASON,
    });

    expect(result).toEqual({ ok: true, batchStatus: "captured" });
    expect((await batchRow(h, second.batchId)).status).toBe("cancelled");
    expect(await heldBy(h, second.batchId)).toEqual([]);
    const [firstStudent, secondStudent] = school.registrationIds;
    expect(await heldBy(h, first.batchId)).toEqual([
      { registrationId: firstStudent },
    ]);
    const statuses = new Map(
      (await registrationsOf(h, school.registrationIds)).map((r) => [
        r.id,
        r.status,
      ])
    );
    expect(statuses.get(firstStudent!)).toBe("confirmed");
    // Only the replaced batch's own student was paid for.
    expect(statuses.get(secondStudent!)).toBe("enrolled");
  });

  it("won't confirm when a student can no longer be paid for", async () => {
    const h = await createHarness();
    const { school, caseId, batchId } = await mismatchCase(h);
    await h.as(school.coordinator.actor).withdrawStudent({
      ...school.ids,
      registrationId: school.registrationIds[0]!,
    });
    const finance = await signInStaff(h, "finance");
    const before = await paymentRows(h);

    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId,
        outcome: "confirm",
        reason: REASON,
      })
    ).toEqual({ ok: false, error: "registration_not_payable" });
    expect(await paymentRows(h)).toEqual(before);
    expect((await batchRow(h, batchId)).status).toBe("needs_review");
  });

  it("marks money for refund without calling the gateway, and lets an unpaid batch's students go", async () => {
    const h = await createHarness();
    const { school, batchId, orderId, caseId } = await closedCase(h);
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId,
        outcome: "refund",
        reason: REASON,
      })
    ).toEqual({ ok: true, batchStatus: "cancelled" });

    expect(await reviewCasesOf(h, batchId)).toEqual([
      expect.objectContaining({ outcome: "refund", refundDue: true }),
    ]);
    expect(await heldBy(h, batchId)).toEqual([]);
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["enrolled", "enrolled"]);
    expect(
      (await h.gateway.fetchOrderPayments(orderId)).map((p) => p.status)
    ).toEqual(["captured"]);
  });

  it("returns a batch paid before its review to captured, whatever the outcome", async () => {
    const h = await createHarness();
    const { school, batchId, caseId } = await paidTwiceCase(h);
    const confirmed = await registrationsOf(h, school.registrationIds);
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId,
        outcome: "keep",
        reason: "The school asked us to keep it towards next year's fees.",
      })
    ).toEqual({ ok: true, batchStatus: "captured" });

    expect(await batchRow(h, batchId)).toMatchObject({
      status: "captured",
      captureMethod: "offline",
    });
    expect(await reviewCasesOf(h, batchId)).toEqual([
      expect.objectContaining({ outcome: "keep", refundDue: false }),
    ]);
    expect(await registrationsOf(h, school.registrationIds)).toEqual(confirmed);
  });

  it("keeps the batch in review until its last open case is resolved, and confirms only then", async () => {
    const h = await createHarness();
    const { batchId, orderId } = await mismatchCase(h);
    // A second, full payment on the same order.
    h.gateway.capture(orderId);
    await receive(h, orderId);
    const [short, full] = await reviewCasesOf(h, batchId);
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId: short!.id,
        outcome: "confirm",
        reason: REASON,
      })
    ).toEqual({ ok: false, error: "resolve_other_cases_first" });
    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId: full!.id,
        outcome: "refund",
        reason: REASON,
      })
    ).toEqual({ ok: true, batchStatus: "needs_review" });
    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId: short!.id,
        outcome: "confirm",
        reason: REASON,
      })
    ).toEqual({ ok: true, batchStatus: "captured" });
  });

  it("refuses an outcome the case can't have, a reason too short or too long, and a second resolution", async () => {
    const h = await createHarness();
    const { caseId } = await paidTwiceCase(h);
    const finance = await signInStaff(h, "finance");
    const resolve = (outcome: string, reason: string) =>
      h.as(finance.actor).resolvePaymentReviewCase({ caseId, outcome, reason });

    // Already paid: confirming would confirm the students twice.
    expect(await resolve("confirm", REASON)).toEqual({
      ok: false,
      error: "outcome_not_allowed",
    });
    expect(await resolve("refund", "  ok then  ")).toEqual({
      ok: false,
      error: "reason_required",
    });
    expect(await resolve("refund", "x".repeat(2001))).toEqual({
      ok: false,
      error: "reason_too_long",
    });
    expect(await resolve("refund", REASON)).toMatchObject({ ok: true });
    expect(await resolve("keep", REASON)).toEqual({
      ok: false,
      error: "already_resolved",
    });
  });

  it("says when there's no such case", async () => {
    const h = await createHarness();
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId: "01938a00-0000-7000-8000-00000000dead",
        outcome: "refund",
        reason: REASON,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("who may read and resolve review cases", () => {
  it.each<PaymentsStaffRole>(["finance", "staff_admin", "super_admin"])(
    "a %s may",
    async (role) => {
      const h = await createHarness();
      const { caseId } = await closedCase(h);
      const staff = await signInStaff(h, role);

      expect(
        await h.as(staff.actor).listPaymentReviewCases({ state: "open" })
      ).toMatchObject({ ok: true });
      expect(
        await h.as(staff.actor).getPaymentReviewCase({ caseId })
      ).toMatchObject({ ok: true });
      expect(
        await h
          .as(staff.actor)
          .resolvePaymentReviewCase({ caseId, outcome: "keep", reason: REASON })
      ).toMatchObject({ ok: true });
    }
  );

  it.each<[string, (h: Harness, school: School) => Promise<Actor>]>([
    [
      "the batch's own coordinator",
      async (_h, school) => school.coordinator.actor,
    ],
    [
      "a competition manager",
      async (h) => (await signInStaff(h, "competition_manager")).actor,
    ],
    ["a member", async (h) => (await signInStaff(h, null)).actor],
    ["a visitor", async (h) => h.visitor()],
  ])("%s may not, and nothing is written", async (_who, who) => {
    const h = await createHarness();
    const { school, caseId } = await closedCase(h);
    const actor = await who(h, school);
    const before = await paymentRows(h);

    await expect(
      h.as(actor).listPaymentReviewCases({ state: "open" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(actor).getPaymentReviewCase({ caseId })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h
        .as(actor)
        .resolvePaymentReviewCase({ caseId, outcome: "keep", reason: REASON })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await paymentRows(h)).toEqual(before);
  });

  it("needs a fresh second factor to resolve, but not to read", async () => {
    const h = await createHarness();
    const { caseId } = await closedCase(h);
    const finance = await signInStaff(h, "finance");
    h.clock.advance({ minutes: 10, seconds: 1 });

    expect(
      await h.as(finance.actor).getPaymentReviewCase({ caseId })
    ).toMatchObject({ ok: true });
    await expect(
      h
        .as(finance.actor)
        .resolvePaymentReviewCase({ caseId, outcome: "keep", reason: REASON })
    ).rejects.toMatchObject({ code: "step_up_required" });
  });
});
