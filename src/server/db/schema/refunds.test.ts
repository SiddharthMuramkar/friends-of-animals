import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@/server/ids";
import { capturedBatch } from "@/server/modules/payments/refunds/testing";
import { createHarness, type Harness } from "@/test/harness";

import { refund, refundItem } from "./refunds";

// #80: what the refund tables refuse whatever the use cases do: money
// that isn't positive rupees, a gateway refund with no payment, the
// requester deciding, timestamps out of step with the status, and a
// registration held by two live refunds.

/** The database's own message for a refused write, or null if it went in. */
async function refusal(write: PromiseLike<unknown>): Promise<string | null> {
  try {
    await write;
    return null;
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
}

type NewRefund = typeof refund.$inferInsert;

async function world(h: Harness) {
  const paid = await capturedBatch(h, { students: 2 });
  const now = h.clock.now();
  /** A cancellation refund as the system approves it, before it is sent. */
  const approved = (overrides: Partial<NewRefund> = {}): NewRefund => ({
    id: uuidv7(now),
    batchId: paid.batchId,
    gatewayPaymentId: paid.paymentId,
    kind: "cancellation",
    status: "approved",
    method: "gateway",
    amountMinor: 50_000n,
    currency: "INR",
    reason: "The competition was cancelled.",
    requestedAt: now,
    decidedAt: now,
    updatedAt: now,
    ...overrides,
  });
  return { paid, now, approved };
}

describe("refund", () => {
  it("takes the rows the refund machine makes", async () => {
    const h = await createHarness();
    const { approved, now } = await world(h);
    const asker = await h.seed.member();
    const finance = await h.seed.member();

    for (const row of [
      approved({
        kind: "discretionary",
        status: "requested",
        requestedBy: asker.id,
        decidedAt: null,
      }),
      approved({
        kind: "discretionary",
        status: "rejected",
        requestedBy: asker.id,
        decidedBy: finance.id,
        decisionNote: "Outside the policy.",
      }),
      approved({ status: "processing", gatewayRefundId: "rfnd_1" }),
      approved({ status: "refunded", refundedAt: now }),
      approved({ status: "failed", failedAt: now }),
      approved({
        method: "manual",
        gatewayPaymentId: null,
        status: "refunded",
        refundedAt: now,
        manualMethod: "bank_transfer",
        manualReference: "UTIB0001234567",
      }),
    ]) {
      expect(await refusal(h.db.insert(refund).values(row))).toBeNull();
    }
  });

  it.each<[string, (now: Date) => Partial<NewRefund>, RegExp]>([
    [
      "a refund of nothing",
      () => ({ amountMinor: 0n }),
      /refund_amount_positive/,
    ],
    ["another currency", () => ({ currency: "USD" }), /refund_currency_inr/],
    ["an empty reason", () => ({ reason: "  " }), /refund_reason_present/],
    ["attempt 0", () => ({ attempt: 0 }), /refund_attempt_positive/],
    [
      "a gateway refund with no payment to return to",
      () => ({ gatewayPaymentId: null }),
      /refund_gateway_has_payment/,
    ],
    [
      "a manual refund with a gateway refund id",
      () => ({ method: "manual", gatewayRefundId: "rfnd_1" }),
      /refund_manual_has_no_gateway_refund/,
    ],
    [
      "a manual refund refunded with no record of how",
      (now) => ({ method: "manual", status: "refunded", refundedAt: now }),
      /refund_manual_recorded_when_refunded/,
    ],
    [
      "a refunded refund with no time",
      () => ({ status: "refunded" }),
      /refund_refunded_at_when_refunded/,
    ],
    [
      "a refund time on a refund not refunded",
      (now) => ({ refundedAt: now }),
      /refund_refunded_at_when_refunded/,
    ],
    [
      "a failed refund with no time",
      () => ({ status: "failed" }),
      /refund_failed_at_when_failed/,
    ],
    [
      "a duplicate refund that settles no review case",
      () => ({ kind: "duplicate" }),
      /refund_case_only_for_duplicates/,
    ],
  ])("refuses %s", async (_, overrides, constraint) => {
    const h = await createHarness();
    const { approved, now } = await world(h);

    expect(
      await refusal(h.db.insert(refund).values(approved(overrides(now))))
    ).toEqual(expect.stringMatching(constraint));
  });

  it("never lets the person who asked for a refund decide it", async () => {
    const h = await createHarness();
    const { approved, now } = await world(h);
    const asker = await h.seed.member();
    const row = approved({
      kind: "discretionary",
      status: "requested",
      requestedBy: asker.id,
      decidedAt: null,
    });
    await h.db.insert(refund).values(row);

    expect(
      await refusal(
        h.db
          .update(refund)
          .set({ status: "approved", decidedBy: asker.id, decidedAt: now })
          .where(eq(refund.id, row.id))
      )
    ).toEqual(expect.stringMatching(/refund_decider_not_requester/));
  });
});

describe("refund_item", () => {
  it("holds a registration in one live refund at a time, and lets it go once released", async () => {
    const h = await createHarness();
    const { approved, paid, now } = await world(h);
    const [first, second] = [approved(), approved()];
    await h.db.insert(refund).values([first, second]);
    const hold = (refundId: string) =>
      h.db.insert(refundItem).values({
        refundId,
        batchId: paid.batchId,
        registrationId: paid.registrationIds[0]!,
        amountMinor: 50_000n,
      });

    await hold(first.id);
    expect(await refusal(hold(second.id))).toEqual(
      expect.stringMatching(/refund_item_live_registration_unique/)
    );

    await h.db
      .update(refundItem)
      .set({ releasedAt: now })
      .where(eq(refundItem.refundId, first.id));
    expect(await refusal(hold(second.id))).toBeNull();
  });

  it("refuses an item for nothing, and a registration the batch never held", async () => {
    const h = await createHarness();
    const { approved, paid } = await world(h);
    const other = await capturedBatch(h, { students: 1, code: "KITE27" });
    const row = approved();
    await h.db.insert(refund).values(row);

    expect(
      await refusal(
        h.db.insert(refundItem).values({
          refundId: row.id,
          batchId: paid.batchId,
          registrationId: paid.registrationIds[0]!,
          amountMinor: 0n,
        })
      )
    ).toEqual(expect.stringMatching(/refund_item_amount_positive/));
    expect(
      await refusal(
        h.db.insert(refundItem).values({
          refundId: row.id,
          batchId: paid.batchId,
          registrationId: other.registrationIds[0]!,
          amountMinor: 50_000n,
        })
      )
    ).toEqual(expect.stringMatching(/refund_item_batch_item_fk/));
  });
});
