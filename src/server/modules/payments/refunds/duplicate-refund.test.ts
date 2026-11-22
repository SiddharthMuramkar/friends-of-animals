import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { refund } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  batchRow,
  openOrder,
  reviewCasesOf,
  schoolWithStudents,
  signInStaff,
} from "../testing";
import {
  startSystemRefund,
  supersedeRequestedRefunds,
} from "./start-system-refund";
import {
  capturedBatch,
  chequePaidBatch,
  FEE_PAISE,
  REASON,
  refundAudit,
  refundItemsOf,
  refundRow,
  statusesOf,
} from "./testing";

// #80 slice 4: resolving a payment in review with "refund" (#79) refunds
// that payment in full without finance's approval: a duplicate refund,
// approved by its kind. A captured batch paid again stays captured: its
// students stay confirmed while the second payment is reviewed (#79's
// review, finding 4). And `startSystemRefund`, which 80b's cancellations
// call, approves a refund of what a batch has left, once per key.

const RESOLUTION = "The school paid twice by mistake; refund the second.";

const receive = (h: Harness, orderId: string) =>
  h
    .as(h.visitor())
    .receiveGatewayWebhook(
      h.gateway.webhook({ type: "payment.captured", orderId })
    );

/** A captured batch paid a second time on its order, and that case. */
async function paidTwice(h: Harness) {
  const paid = await capturedBatch(h, { students: 2 });
  const second = h.gateway.capture(paid.orderId);
  await receive(h, paid.orderId);
  const [opened] = await reviewCasesOf(h, paid.batchId);
  if (!opened) throw new Error("no case");
  return { ...paid, secondPaymentId: second.paymentId, caseId: opened.id };
}

describe("a captured batch paid again", () => {
  it("stays captured, its students confirmed, with a case for the second payment", async () => {
    const h = await createHarness();
    const paid = await paidTwice(h);

    expect(await batchRow(h, paid.batchId)).toMatchObject({
      status: "captured",
      gatewayPaymentId: paid.paymentId,
    });
    expect(await reviewCasesOf(h, paid.batchId)).toEqual([
      expect.objectContaining({
        reason: "already_paid",
        gatewayPaymentId: paid.secondPaymentId,
        batchStatusBefore: "captured",
      }),
    ]);
    const coordinatorView = await h
      .as(paid.school.coordinator.actor)
      .getPaymentBatch({
        institutionId: paid.school.institutionId,
        batchId: paid.batchId,
      });
    expect(coordinatorView).toMatchObject({
      ok: true,
      batch: { status: "captured" },
    });
  });
});

describe("resolving a payment in review with a refund", () => {
  it("refunds that payment in full at once, with no approver; the students stay confirmed", async () => {
    const h = await createHarness();
    const paid = await paidTwice(h);
    const staff = await signInStaff(h, "staff_admin");

    expect(
      await h.as(staff.actor).resolvePaymentReviewCase({
        caseId: paid.caseId,
        outcome: "refund",
        reason: RESOLUTION,
      })
    ).toEqual({ ok: true, batchStatus: "captured" });

    const [made] = await h.db
      .select()
      .from(refund)
      .where(eq(refund.reviewCaseId, paid.caseId));
    expect(made).toMatchObject({
      batchId: paid.batchId,
      kind: "duplicate",
      status: "approved",
      method: "gateway",
      gatewayPaymentId: paid.secondPaymentId,
      amountMinor: FEE_PAISE * 2n,
      reason: RESOLUTION,
      requestedBy: null,
      decidedBy: null,
    });
    expect(await refundItemsOf(h, made!.id)).toEqual([]);
    expect((await refundAudit(h)).at(-1)).toMatchObject({
      action: "refund.approved",
      actorUserId: staff.userId,
      before: null,
      after: {
        kind: "duplicate",
        status: "approved",
        reviewCaseId: paid.caseId,
      },
    });

    await h.drain();

    expect(h.gateway.refunds).toEqual([
      expect.objectContaining({
        paymentId: paid.secondPaymentId,
        amountMinor: FEE_PAISE * 2n,
        idempotencyKey: `${made!.id}-1`,
      }),
    ]);
    expect((await refundRow(h, made!.id)).status).toBe("refunded");
    expect(await statusesOf(h, paid.registrationIds)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    expect((await batchRow(h, paid.batchId)).status).toBe("captured");
  });

  it("refunds a short payment in full, the batch letting its students go", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    const { paymentId } = h.gateway.capture(orderId, {
      amount: { amountMinor: 99_900n, currency: "INR" },
    });
    await receive(h, orderId);
    const [opened] = await reviewCasesOf(h, batchId);
    const finance = await signInStaff(h, "finance");

    await h.as(finance.actor).resolvePaymentReviewCase({
      caseId: opened!.id,
      outcome: "refund",
      reason: "Paid ₹1 short; refunding so they can pay again.",
    });
    await h.drain();

    expect(h.gateway.refunds).toEqual([
      expect.objectContaining({ paymentId, amountMinor: 99_900n }),
    ]);
    expect((await batchRow(h, batchId)).status).toBe("cancelled");
  });

  it("starts one refund however often it is asked: a second resolution is refused", async () => {
    const h = await createHarness();
    const paid = await paidTwice(h);
    const finance = await signInStaff(h, "finance");
    const resolve = () =>
      h.as(finance.actor).resolvePaymentReviewCase({
        caseId: paid.caseId,
        outcome: "refund",
        reason: RESOLUTION,
      });
    await resolve();

    expect(await resolve()).toEqual({ ok: false, error: "already_resolved" });
    expect(await h.db.select().from(refund)).toHaveLength(1);
  });

  it("lets finance resolve with a refund and refuses the school's coordinator", async () => {
    const h = await createHarness();
    const paid = await paidTwice(h);

    await expect(
      h.as(paid.school.coordinator.actor).resolvePaymentReviewCase({
        caseId: paid.caseId,
        outcome: "refund",
        reason: RESOLUTION,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await h.db.select().from(refund)).toEqual([]);

    const finance = await signInStaff(h, "finance");
    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId: paid.caseId,
        outcome: "refund",
        reason: RESOLUTION,
      })
    ).toMatchObject({ ok: true });
  });
});

describe("a full payment while another is in review (#79's review, finding 2)", () => {
  it("opens a case staff can accept once the short payment is refunded", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    h.gateway.capture(orderId, {
      amount: { amountMinor: 99_900n, currency: "INR" },
    });
    await receive(h, orderId);
    const full = h.gateway.capture(orderId);
    await receive(h, orderId);
    const [short, second] = await reviewCasesOf(h, batchId);
    expect(second).toMatchObject({
      reason: "paid_while_in_review",
      gatewayPaymentId: full.paymentId,
      batchStatusBefore: "order_created",
    });
    const finance = await signInStaff(h, "finance");

    await h.as(finance.actor).resolvePaymentReviewCase({
      caseId: short!.id,
      outcome: "refund",
      reason: "Paid ₹1 short, then paid in full: refund the short one.",
    });
    expect(
      await h.as(finance.actor).resolvePaymentReviewCase({
        caseId: second!.id,
        outcome: "confirm",
        reason: "The full payment is right: accept it.",
      })
    ).toEqual({ ok: true, batchStatus: "captured" });
    expect(await statusesOf(h, school.registrationIds)).toEqual([
      "confirmed",
      "confirmed",
    ]);
  });
});

describe("startSystemRefund (for 80b's cancellations)", () => {
  it("approves a refund of every student the batch has left, once per key", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 3 });
    const system = {
      clock: h.clock,
      actor: { kind: "system", process: "worker" },
    } as const;
    const cancel = () =>
      h.db.transaction((tx) =>
        startSystemRefund(tx, system, {
          kind: "cancellation",
          batchId: paid.batchId,
          reason: "The competition was cancelled.",
          idempotencyKey: `cancel:${paid.batchId}`,
        })
      );

    const first = await cancel();
    const again = await cancel();

    expect(first).toEqual({ refundId: expect.any(String) });
    expect(again).toEqual(first);
    if (!("refundId" in first)) return;
    expect(await refundRow(h, first.refundId)).toMatchObject({
      kind: "cancellation",
      status: "approved",
      amountMinor: FEE_PAISE * 3n,
      requestedBy: null,
      decidedBy: null,
    });
    await h.drain();
    expect((await refundRow(h, first.refundId)).status).toBe("refunded");
    expect(await statusesOf(h, paid.registrationIds)).toEqual([
      "refunded",
      "refunded",
      "refunded",
    ]);
    expect(
      await h.db.transaction((tx) =>
        startSystemRefund(tx, system, {
          kind: "cancellation",
          batchId: paid.batchId,
          reason: "The competition was cancelled.",
          idempotencyKey: `cancel-again:${paid.batchId}`,
        })
      )
    ).toEqual({ skipped: "nothing_to_refund" });
  });

  it("refunds a batch paid offline by hand, and supersedes a request so its students can be cancelled", async () => {
    const h = await createHarness();
    const paid = await chequePaidBatch(h);
    const staff = await signInStaff(h, "staff_admin");
    const asked = await h
      .as(staff.actor)
      .requestRefund({ batchId: paid.batchId, reason: REASON });
    if (!asked.ok) throw new Error("not asked");
    const system = {
      clock: h.clock,
      actor: { kind: "system", process: "worker" },
    } as const;

    const result = await h.db.transaction(async (tx) => {
      const superseded = await supersedeRequestedRefunds(tx, system, {
        batchIds: [paid.batchId],
        reason: "The competition was cancelled.",
      });
      const made = await startSystemRefund(tx, system, {
        kind: "cancellation",
        batchId: paid.batchId,
        reason: "The competition was cancelled.",
        idempotencyKey: `cancel:${paid.batchId}`,
      });
      return { superseded, made };
    });

    expect(result.superseded).toEqual([asked.refundId]);
    expect((await refundRow(h, asked.refundId)).status).toBe("rejected");
    if (!("refundId" in result.made)) throw new Error("skipped");
    expect(await refundRow(h, result.made.refundId)).toMatchObject({
      status: "approved",
      method: "manual",
      amountMinor: FEE_PAISE * 2n,
    });
  });
});
