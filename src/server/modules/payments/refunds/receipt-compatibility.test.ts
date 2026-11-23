import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { paymentReviewCase } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  openOrder,
  reviewCasesOf,
  schoolWithStudents,
  signInStaff,
} from "../testing";
import {
  REASON,
  refundAudit,
  refundItemsOf,
  signInManager,
  statusesOf,
} from "./testing";

const receive = (h: Harness, orderId: string) =>
  h
    .as(h.visitor())
    .receiveGatewayWebhook(
      h.gateway.webhook({ type: "payment.captured", orderId })
    );

async function acceptedReceipt(
  h: Harness,
  amountMinor: bigint,
  currency: string
) {
  const school = await schoolWithStudents(h, { students: 2 });
  const { batchId, orderId } = await openOrder(school);
  const { paymentId } = h.gateway.capture(orderId, {
    amount: { amountMinor, currency },
  });
  expect(await receive(h, orderId)).toEqual({
    ok: true,
    outcome: "needs_review",
  });
  const [receipt] = await reviewCasesOf(h, batchId);
  if (!receipt) throw new Error("Missing payment review case");
  const finance = h.as((await signInStaff(h, "finance")).actor);
  const staff = h.as((await signInStaff(h, "staff_admin")).actor);

  // Reproduce a capture that finance could confirm before the INR guard.
  const setReceiptCurrency = (currency: string) =>
    h.db
      .update(paymentReviewCase)
      .set({ currency })
      .where(eq(paymentReviewCase.id, receipt.id));
  if (currency !== "INR") await setReceiptCurrency("INR");
  expect(
    await finance.resolvePaymentReviewCase({
      caseId: receipt.id,
      outcome: "confirm",
      reason: "The school confirmed the amount on their receipt.",
    })
  ).toEqual({ ok: true, batchStatus: "captured" });
  if (currency !== "INR") await setReceiptCurrency(currency);
  return { batchId, orderId, paymentId, school, receipt, finance, staff };
}

it("shows an accepted historical receipt in its currency and refuses a discretionary payout", async () => {
  const h = await createHarness();
  const { batchId, orderId, school, finance, staff, receipt } =
    await acceptedReceipt(h, 1200n, "USD");

  expect(await staff.getRefundableBatch({ batchId })).toMatchObject({
    ok: true,
    batch: {
      amountMinor: 1200n,
      currency: "USD",
      payout: { kind: "dashboard", reviewCaseId: receipt.id, state: "review" },
      refunds: [],
    },
  });
  expect(await staff.requestRefund({ batchId, reason: REASON })).toEqual({
    ok: false,
    error: "dashboard_managed",
  });
  expect(h.gateway.refunds).toEqual([]);

  const manager = await signInManager(h, school);
  expect(
    await h.as(manager.actor).getRefundableBatch({ batchId })
  ).toMatchObject({
    ok: true,
    batch: { payout: { kind: "dashboard", reviewCaseId: null } },
  });
  expect(await staff.getPaymentBatchForStaff({ batchId })).toMatchObject({
    ok: true,
    batch: {
      amountMinor: 100_000n,
      acceptedReceipt: { amountMinor: 1200n, currency: "USD" },
    },
  });

  const { paymentId: duplicatePaymentId } = h.gateway.capture(orderId);
  await receive(h, orderId);
  const duplicate = (await reviewCasesOf(h, batchId)).find(
    ({ reason }) => reason === "already_paid"
  );
  if (!duplicate) throw new Error("Missing duplicate payment review");
  expect(
    await finance.resolvePaymentReviewCase({
      caseId: duplicate.id,
      outcome: "refund",
      reason: "The payer already paid the competition fee.",
    })
  ).toEqual({ ok: true, batchStatus: "captured" });
  await h.drain();
  expect(h.gateway.refunds).toEqual([
    expect.objectContaining({
      paymentId: duplicatePaymentId,
      currency: "INR",
      amountMinor: 100_000n,
    }),
  ]);
  const history = await staff.getRefundableBatch({ batchId });
  expect(history).toMatchObject({
    ok: true,
    batch: {
      amountMinor: 1200n,
      currency: "USD",
      refunds: [
        { kind: "duplicate", status: "refunded", amountMinor: 100_000n },
      ],
    },
  });
  if (!history.ok || !history.batch.refunds[0])
    throw new Error("Missing refund history");
  expect(
    await finance.getRefund({ refundId: history.batch.refunds[0].id })
  ).toMatchObject({
    ok: true,
    refund: {
      kind: "duplicate",
      batchAmountMinor: 1200n,
      batchCurrency: "USD",
      amountMinor: 100_000n,
    },
  });
  expect(await statusesOf(h, school.registrationIds)).toEqual([
    "confirmed",
    "confirmed",
  ]);
});

it.each([
  { amountMinor: 40_001n, shares: [20_000n, 20_001n] },
  { amountMinor: 1n, shares: [1n] },
])(
  "allocates a reviewed INR capture of $amountMinor minor units with positive refund items",
  async ({ amountMinor, shares }) => {
    const h = await createHarness();
    const { batchId, paymentId, finance, staff } = await acceptedReceipt(
      h,
      amountMinor,
      "INR"
    );
    const request = await staff.requestRefund({ batchId, reason: REASON });
    expect(request).toMatchObject({ ok: true, amountMinor });
    if (!request.ok) throw new Error("Refund request was refused");
    expect(
      (await refundItemsOf(h, request.refundId)).map((item) => item.amountMinor)
    ).toEqual(shares);
    expect(await finance.approveRefund({ refundId: request.refundId })).toEqual(
      { ok: true, status: "approved" }
    );
    await h.drain();
    await h.drain();
    expect(h.gateway.refunds).toEqual([
      expect.objectContaining({ paymentId, amountMinor, currency: "INR" }),
    ]);
    expect(await staff.requestRefund({ batchId, reason: REASON })).toEqual({
      ok: false,
      error: "nothing_to_refund",
    });
  }
);

it("does not send a queued INR approval against a historical foreign-currency receipt", async () => {
  const h = await createHarness();
  const { batchId, receipt, finance, staff } = await acceptedReceipt(
    h,
    1200n,
    "USD"
  );
  const setReceiptCurrency = (currency: string) =>
    h.db
      .update(paymentReviewCase)
      .set({ currency })
      .where(eq(paymentReviewCase.id, receipt.id));
  await setReceiptCurrency("INR");
  const asked = await staff.requestRefund({ batchId, reason: REASON });
  if (!asked.ok) throw new Error("Missing legacy approval to replay");
  expect(await finance.approveRefund({ refundId: asked.refundId })).toEqual({
    ok: true,
    status: "approved",
  });
  await setReceiptCurrency("USD");

  await h.drain();

  expect(await finance.getRefund({ refundId: asked.refundId })).toMatchObject({
    ok: true,
    refund: { status: "failed", gatewayRefundId: null, batchCurrency: "USD" },
  });
  expect((await refundAudit(h)).at(-1)).toMatchObject({
    action: "refund.failed",
    after: { dashboardManaged: true },
  });
  expect(h.gateway.refunds).toEqual([]);
});
