import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@/server/ids";
import { createTestDb, type TestDb } from "@/test/db";

import { user } from "./identity";
import { refund, refundItem } from "./refunds";

const now = new Date("2027-01-15T04:30:00Z");

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

/** A user who can ask for or decide refunds; returns their id. */
async function staffMember(db: TestDb, email: string): Promise<string> {
  const id = uuidv7(now);
  await db
    .insert(user)
    .values({ id, name: "Staff", email, createdAt: now, updatedAt: now });
  return id;
}

type NewRefund = typeof refund.$inferInsert;

/** A cancellation refund as the system approves it, before it is sent. */
function approvedRefund(overrides: Partial<NewRefund> = {}): NewRefund {
  return {
    id: uuidv7(now),
    batchId: uuidv7(now),
    gatewayPaymentId: "pay_1",
    kind: "cancellation",
    status: "approved",
    method: "gateway",
    amountMinor: 50_000n,
    currency: "INR",
    reason: "The competition was cancelled.",
    requestedAt: now,
    decidedAt: now,
    ...overrides,
  };
}

describe("refund_item", () => {
  it("holds a batch item in one live refund at a time, and lets it go once released", async () => {
    const db = await createTestDb();
    const [first, second] = [approvedRefund(), approvedRefund()];
    await db.insert(refund).values([first, second]);
    const batchItemId = uuidv7(now);
    const hold = (refundId: string) =>
      db
        .insert(refundItem)
        .values({ refundId, batchItemId, amountMinor: 25_000n });

    await hold(first.id);
    expect(await refusal(hold(second.id))).toEqual(
      expect.stringMatching(/refund_item_live_batch_item_key/)
    );

    await db
      .update(refundItem)
      .set({ releasedAt: now })
      .where(eq(refundItem.refundId, first.id));
    expect(await refusal(hold(second.id))).toBeNull();
  });

  it("refuses an item refunded for nothing", async () => {
    const db = await createTestDb();
    const row = approvedRefund();
    await db.insert(refund).values(row);

    expect(
      await refusal(
        db.insert(refundItem).values({
          refundId: row.id,
          batchItemId: uuidv7(now),
          amountMinor: 0n,
        })
      )
    ).toEqual(expect.stringMatching(/refund_item_amount_positive/));
  });
});

describe("refund", () => {
  it("never lets the person who asked for a refund decide it", async () => {
    const db = await createTestDb();
    const asker = await staffMember(db, "asker@example.test");
    const row = approvedRefund({
      kind: "discretionary",
      status: "requested",
      requestedBy: asker,
      decidedAt: null,
    });
    await db.insert(refund).values(row);

    expect(
      await refusal(
        db
          .update(refund)
          .set({ status: "approved", decidedBy: asker, decidedAt: now })
          .where(eq(refund.id, row.id))
      )
    ).toEqual(expect.stringMatching(/refund_decider_not_requester/));
  });

  it("takes the rows the refund machine makes", async () => {
    const db = await createTestDb();
    const asker = await staffMember(db, "asker@example.test");
    const finance = await staffMember(db, "finance@example.test");

    for (const row of [
      approvedRefund({
        kind: "discretionary",
        status: "requested",
        requestedBy: asker,
        decidedAt: null,
      }),
      approvedRefund({
        kind: "discretionary",
        status: "rejected",
        requestedBy: asker,
        decidedBy: finance,
        decisionNote: "Confirmed registrations are not refunded.",
      }),
      approvedRefund({ status: "processing", gatewayRefundId: "rfnd_1" }),
      approvedRefund({ status: "refunded", refundedAt: now }),
      approvedRefund({ status: "failed", failedAt: now }),
      approvedRefund({
        method: "manual",
        gatewayPaymentId: null,
        status: "refunded",
        refundedAt: now,
        manualMethod: "bank_transfer",
        manualReference: "UTIB0001234567",
      }),
    ]) {
      expect(await refusal(db.insert(refund).values(row))).toBeNull();
    }
  });

  it.each<[string, Partial<NewRefund>, RegExp]>([
    ["a refund of nothing", { amountMinor: 0n }, /refund_amount_positive/],
    ["a currency other than rupees", { currency: "USD" as "INR" }, /refund_currency_inr/],
    ["an empty reason", { reason: "  " }, /refund_reason_present/],
    ["a reason past 2,000 characters", { reason: "x".repeat(2001) }, /refund_reason_length/],
    [
      "a discretionary refund nobody asked for",
      { kind: "discretionary" },
      /refund_requester_matches_kind/,
    ],
    [
      "a gateway refund with no payment to return to",
      { gatewayPaymentId: null },
      /refund_gateway_needs_payment/,
    ],
    [
      "a manual refund with a gateway refund id",
      { method: "manual", gatewayRefundId: "rfnd_1" },
      /refund_manual_has_no_gateway_refund/,
    ],
    [
      "a manual record on a gateway refund",
      { manualMethod: "cheque", manualReference: "004512" },
      /refund_manual_record_on_manual/,
    ],
    [
      "a manual method without its reference",
      { method: "manual", manualMethod: "cheque" },
      /refund_manual_record_complete/,
    ],
    [
      "a manual refund marked refunded with no record of how",
      { method: "manual", status: "refunded", refundedAt: now },
      /refund_manual_refunded_recorded/,
    ],
    [
      "a refunded refund with no time it was refunded",
      { status: "refunded" },
      /refund_refunded_at_when_refunded/,
    ],
    [
      "a refund time on a refund not refunded",
      { refundedAt: now },
      /refund_refunded_at_when_refunded/,
    ],
    [
      "a failed refund with no time it failed",
      { status: "failed" },
      /refund_failed_at_when_failed/,
    ],
    [
      "a decided refund with no time of decision",
      { decidedAt: null },
      /refund_decided_unless_requested/,
    ],
    [
      "a rejected refund with no note saying why",
      { status: "rejected", decisionNote: " " },
      /refund_rejected_has_note/,
    ],
    ["attempt 0", { attempt: 0 }, /refund_attempt_positive/],
  ])("refuses %s", async (_, overrides, constraint) => {
    const db = await createTestDb();

    expect(
      await refusal(db.insert(refund).values(approvedRefund(overrides)))
    ).toEqual(expect.stringMatching(constraint));
  });

  it("refuses a requester on a refund the system made", async () => {
    const db = await createTestDb();
    const asker = await staffMember(db, "asker@example.test");

    expect(
      await refusal(
        db.insert(refund).values(approvedRefund({ requestedBy: asker }))
      )
    ).toEqual(expect.stringMatching(/refund_requester_matches_kind/));
  });

  it("refuses a requested refund that was already decided", async () => {
    const db = await createTestDb();
    const asker = await staffMember(db, "asker@example.test");

    expect(
      await refusal(
        db.insert(refund).values(
          approvedRefund({
            kind: "discretionary",
            status: "requested",
            requestedBy: asker,
          })
        )
      )
    ).toEqual(expect.stringMatching(/refund_decided_unless_requested/));
  });
});
