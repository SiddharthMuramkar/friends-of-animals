import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { expect, it } from "vitest";

import { createApp } from "@/server/app";
import * as schema from "@/server/db/schema";
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
  currency: string,
  students = 2
) {
  const school = await schoolWithStudents(h, { students });
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
  const staffActor = (await signInStaff(h, "staff_admin")).actor;
  const staff = h.as(staffActor);

  // Reproduce a capture that finance could confirm before the INR guard.
  const setReceiptCurrency = (currency: string) =>
    h.db
      .update(schema.paymentReviewCase)
      .set({ currency })
      .where(eq(schema.paymentReviewCase.id, receipt.id));
  if (currency !== "INR") await setReceiptCurrency("INR");
  expect(
    await finance.resolvePaymentReviewCase({
      caseId: receipt.id,
      outcome: "confirm",
      reason: "The school confirmed the amount on their receipt.",
    })
  ).toEqual({ ok: true, batchStatus: "captured" });
  if (currency !== "INR") await setReceiptCurrency(currency);
  return {
    batchId,
    orderId,
    paymentId,
    school,
    receipt,
    finance,
    staff,
    staffActor,
  };
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
    const { batchId, paymentId, finance, staff, school } =
      await acceptedReceipt(h, amountMinor, "INR");
    const registrationIds = [...school.registrationIds].sort();
    const request = await staff.requestRefund({ batchId, reason: REASON });
    expect(request).toMatchObject({ ok: true, amountMinor, registrationIds });
    if (!request.ok) throw new Error("Refund request was refused");
    expect(
      (await refundItemsOf(h, request.refundId)).map((item) => item.amountMinor)
    ).toEqual(shares);
    expect(
      await finance.getRefund({ refundId: request.refundId })
    ).toMatchObject({
      ok: true,
      refund: {
        students: 2,
        items: registrationIds.map((registrationId) => ({ registrationId })),
      },
    });
    expect(await finance.approveRefund({ refundId: request.refundId })).toEqual(
      { ok: true, status: "approved" }
    );
    await h.drain();
    await h.drain();
    expect(h.gateway.refunds).toEqual([
      expect.objectContaining({ paymentId, amountMinor, currency: "INR" }),
    ]);
    expect(await statusesOf(h, school.registrationIds)).toEqual([
      "refunded",
      "refunded",
    ]);
    expect(
      await staff.requestRefund({
        batchId,
        registrationIds: [registrationIds[0]!],
        reason: REASON,
      })
    ).toEqual({
      ok: false,
      error: "item_already_refunded",
      registrationId: registrationIds[0],
    });
    expect(await staff.requestRefund({ batchId, reason: REASON })).toEqual({
      ok: false,
      error: "nothing_to_refund",
    });
  }
);

it("settles every registration explicitly selected for a one-paise refund", async () => {
  const h = await createHarness();
  const { batchId, paymentId, school, finance, staff } = await acceptedReceipt(
    h,
    1n,
    "INR"
  );
  const registrationIds = [...school.registrationIds].sort().reverse();
  const request = await staff.requestRefund({
    batchId,
    registrationIds,
    reason: REASON,
  });
  if (!request.ok) throw new Error("Refund request was refused");
  expect(await finance.approveRefund({ refundId: request.refundId })).toEqual({
    ok: true,
    status: "approved",
  });
  await h.drain();
  expect(h.gateway.refunds).toEqual([
    expect.objectContaining({ paymentId, amountMinor: 1n, currency: "INR" }),
  ]);
  expect(await statusesOf(h, registrationIds)).toEqual([
    "refunded",
    "refunded",
  ]);
  expect(request).toMatchObject({ amountMinor: 1n, registrationIds });
});

it("holds and settles the zero-share registration in an explicit partial request", async () => {
  const h = await createHarness();
  const { batchId, paymentId, school, finance, staff } = await acceptedReceipt(
    h,
    2n,
    "INR",
    3
  );
  const [zeroShare, unselected, selected] = [...school.registrationIds].sort();
  const registrationIds = [selected!, zeroShare!];
  const request = await staff.requestRefund({
    batchId,
    registrationIds,
    reason: REASON,
  });
  expect(request).toMatchObject({ ok: true, amountMinor: 1n, registrationIds });
  if (!request.ok) throw new Error("Refund request was refused");
  expect(
    await staff.requestRefund({
      batchId,
      registrationIds: [zeroShare!],
      reason: REASON,
    })
  ).toEqual({
    ok: false,
    error: "item_in_live_refund",
    registrationId: zeroShare,
  });
  expect((await refundAudit(h)).at(-1)).toMatchObject({
    action: "refund.requested",
    after: { registrationIds },
  });
  expect(await finance.approveRefund({ refundId: request.refundId })).toEqual({
    ok: true,
    status: "approved",
  });
  await h.drain();
  expect(h.gateway.refunds).toEqual([
    expect.objectContaining({ paymentId, amountMinor: 1n, currency: "INR" }),
  ]);
  expect(await statusesOf(h, school.registrationIds)).toEqual([
    "refunded",
    "confirmed",
    "refunded",
  ]);
  expect(await staff.requestRefund({ batchId, reason: REASON })).toMatchObject({
    ok: true,
    amountMinor: 1n,
    registrationIds: [unselected],
  });
});

it("reads only live holds and the committed total when requesting a refund with rejected history", async () => {
  const h = await createHarness();
  const { batchId, school, finance, staff, staffActor } = await acceptedReceipt(
    h,
    40_001n,
    "INR"
  );
  const [first, second] = [...school.registrationIds].sort();
  for (let i = 0; i < 6; i++) {
    const asked = await staff.requestRefund({ batchId, reason: REASON });
    if (!asked.ok) throw new Error("Refund request was refused");
    expect(
      await finance.rejectRefund({ refundId: asked.refundId, note: REASON })
    ).toEqual({ ok: true, status: "rejected" });
  }
  const held = { batchId, registrationIds: [first!], reason: REASON };
  expect(await staff.requestRefund(held)).toMatchObject({
    ok: true,
    amountMinor: 20_000n,
  });

  const reads: { statement: string; params: unknown[] }[] = [];
  const db = drizzle({
    client: h.db.$client,
    schema,
    logger: {
      logQuery(statement, params) {
        if (
          /^(select|with)\b/i.test(statement) &&
          /"refund(?:_item)?"/.test(statement)
        ) {
          reads.push({ statement, params });
        }
      },
    },
  });
  expect(
    await createApp({ ...h.deps, db })
      .as(staffActor)
      .requestRefund(held)
  ).toEqual({ ok: false, error: "item_in_live_refund", registrationId: first });
  expect(reads).toHaveLength(1);
  const { statement, params } = reads[0]!;
  // The refused request left the same snapshot in place. Measure the result
  // size of its actual query, independent of timings on the test host.
  const result = await db.$client.query(statement, params);
  expect(result.rows.length).toBeLessThanOrEqual(2);

  expect(
    await staff.requestRefund({
      batchId,
      registrationIds: [second!],
      reason: REASON,
    })
  ).toMatchObject({ ok: true, amountMinor: 20_001n });
});

async function legacyWholeApproval(h: Harness) {
  const capture = await acceptedReceipt(h, 140_000n, "INR");
  const { batchId, receipt, finance, staff } = capture;
  const setReceiptAmount = (amountMinor: bigint) =>
    h.db
      .update(schema.paymentReviewCase)
      .set({ amountMinor })
      .where(eq(schema.paymentReviewCase.id, receipt.id));
  await setReceiptAmount(100_000n);
  const legacy = await staff.requestRefund({ batchId, reason: REASON });
  expect(legacy).toMatchObject({ ok: true, amountMinor: 100_000n });
  if (!legacy.ok) throw new Error("Missing legacy approval to replay");
  expect(await finance.approveRefund({ refundId: legacy.refundId })).toEqual({
    ok: true,
    status: "approved",
  });
  await setReceiptAmount(140_000n);
  return { ...capture, legacy };
}

it("closes and replaces a queued whole approval priced at the old quote", async () => {
  const h = await createHarness();
  const { batchId, paymentId, school, finance, staff, legacy } =
    await legacyWholeApproval(h);

  await h.drain();

  expect(h.gateway.refunds).toEqual([]);
  expect((await refundAudit(h)).at(-1)).toMatchObject({
    action: "refund.failed",
    after: { approvedAmountMinor: "100000", availableAmountMinor: "140000" },
  });
  expect(await finance.getRefund({ refundId: legacy.refundId })).toMatchObject({
    ok: true,
    refund: { status: "failed", amountMinor: 100_000n, gatewayRefundId: null },
  });
  expect(await statusesOf(h, school.registrationIds)).toEqual([
    "confirmed",
    "confirmed",
  ]);
  expect(
    await finance.rejectRefund({ refundId: legacy.refundId, note: REASON })
  ).toEqual({
    ok: true,
    status: "rejected",
  });
  const replacement = await staff.requestRefund({ batchId, reason: REASON });
  expect(replacement).toMatchObject({ ok: true, amountMinor: 140_000n });
  if (!replacement.ok) throw new Error("Refund replacement was refused");
  expect(
    await finance.approveRefund({ refundId: replacement.refundId })
  ).toEqual({
    ok: true,
    status: "approved",
  });
  await h.drain();
  expect(h.gateway.refunds).toEqual([
    expect.objectContaining({
      paymentId,
      amountMinor: 140_000n,
      currency: "INR",
    }),
  ]);
  expect(await finance.getRefund({ refundId: legacy.refundId })).toMatchObject({
    ok: true,
    refund: {
      status: "rejected",
      amountMinor: 100_000n,
      gatewayRefundId: null,
    },
  });
  expect(await statusesOf(h, school.registrationIds)).toEqual([
    "refunded",
    "refunded",
  ]);
});

it("adopts a provider settlement made before a legacy approval was revalidated", async () => {
  const h = await createHarness();
  const { legacy, finance, paymentId, school } = await legacyWholeApproval(h);
  const settled = await h.gateway.refund({
    paymentId,
    amount: { amountMinor: 100_000n, currency: "INR" },
    idempotencyKey: `${legacy.refundId}-1`,
    notes: { refundId: legacy.refundId, attempt: "1" },
  });
  await h.drain();
  expect(await finance.getRefund({ refundId: legacy.refundId })).toMatchObject({
    ok: true,
    refund: {
      status: "refunded",
      amountMinor: 100_000n,
      gatewayRefundId: settled.id,
    },
  });
  expect(h.gateway.refunds).toHaveLength(1);
  expect(await statusesOf(h, school.registrationIds)).toEqual([
    "refunded",
    "refunded",
  ]);
});

it("fails a queued partial approval that exceeds the balance reserved for it", async () => {
  const h = await createHarness();
  const { batchId, receipt, school, finance, staff } = await acceptedReceipt(
    h,
    140_000n,
    "INR"
  );
  const setReceiptAmount = (amountMinor: bigint) =>
    h.db
      .update(schema.paymentReviewCase)
      .set({ amountMinor })
      .where(eq(schema.paymentReviewCase.id, receipt.id));
  await setReceiptAmount(160_000n);
  const ask = (registrationId: string) =>
    staff.requestRefund({
      batchId,
      registrationIds: [registrationId],
      reason: REASON,
    });
  const queued = await ask(school.registrationIds[0]!);
  const reserved = await ask(school.registrationIds[1]!);
  expect(queued).toMatchObject({ ok: true, amountMinor: 80_000n });
  expect(reserved).toMatchObject({ ok: true, amountMinor: 80_000n });
  if (!queued.ok || !reserved.ok)
    throw new Error("Missing approval or reservation");
  expect(await finance.approveRefund({ refundId: queued.refundId })).toEqual({
    ok: true,
    status: "approved",
  });
  await setReceiptAmount(140_000n);

  await h.drain();

  expect(h.gateway.refunds).toEqual([]);
  expect(await finance.getRefund({ refundId: queued.refundId })).toMatchObject({
    ok: true,
    refund: { status: "failed", amountMinor: 80_000n, gatewayRefundId: null },
  });
  expect(
    await finance.getRefund({ refundId: reserved.refundId })
  ).toMatchObject({
    ok: true,
    refund: {
      status: "requested",
      amountMinor: 80_000n,
      gatewayRefundId: null,
    },
  });
});

it("does not send a queued INR approval against a historical foreign-currency receipt", async () => {
  const h = await createHarness();
  const { batchId, receipt, finance, staff } = await acceptedReceipt(
    h,
    1200n,
    "USD"
  );
  const setReceiptCurrency = (currency: string) =>
    h.db
      .update(schema.paymentReviewCase)
      .set({ currency })
      .where(eq(schema.paymentReviewCase.id, receipt.id));
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
