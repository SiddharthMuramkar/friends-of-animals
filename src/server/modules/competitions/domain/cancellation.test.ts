import { describe, expect, it } from "vitest";

import {
  planCancellation,
  type CancellationInput,
  type PaidItem,
} from "./cancellation";

function item(
  overrides: Partial<PaidItem> & Pick<PaidItem, "itemId" | "registrationId">
): PaidItem {
  return {
    batchId: "batch-1",
    amountMinor: 25_000n,
    refund: { kind: "none" },
    ...overrides,
  };
}

const EMPTY: CancellationInput = {
  registrations: [],
  paidBatches: [],
  paidItems: [],
  openBatchIds: [],
};

describe("planCancellation()", () => {
  it("does nothing for a competition nobody registered for", () => {
    expect(planCancellation(EMPTY)).toEqual({
      supersede: [],
      refunds: [],
      cancelRegistrations: [],
      cancelBatches: [],
      notify: [],
    });
  });

  it("refunds every paid batch in full, one refund per batch", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "confirmed" },
        { id: "reg-2", standing: "confirmed" },
        { id: "reg-3", standing: "confirmed" },
      ],
      paidBatches: [
        { id: "batch-1", method: "gateway" },
        { id: "batch-2", method: "gateway" },
      ],
      paidItems: [
        item({ itemId: "item-1", registrationId: "reg-1" }),
        item({ itemId: "item-2", registrationId: "reg-2" }),
        item({
          itemId: "item-3",
          registrationId: "reg-3",
          batchId: "batch-2",
          amountMinor: 40_000n,
        }),
      ],
    });
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "gateway",
        itemIds: ["item-1", "item-2"],
        amountMinor: 50_000n,
      },
      {
        batchId: "batch-2",
        method: "gateway",
        itemIds: ["item-3"],
        amountMinor: 40_000n,
      },
    ]);
    expect(plan.cancelRegistrations).toEqual([]);
    expect(plan.notify).toEqual(["reg-1", "reg-2", "reg-3"]);
  });

  it("skips items already refunded and items an approved refund holds", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "refunded" },
        { id: "reg-2", standing: "confirmed" },
        { id: "reg-3", standing: "confirmed" },
      ],
      paidBatches: [{ id: "batch-1", method: "gateway" }],
      paidItems: [
        item({
          itemId: "item-1",
          registrationId: "reg-1",
          refund: { kind: "refunded" },
        }),
        item({
          itemId: "item-2",
          registrationId: "reg-2",
          refund: { kind: "held" },
        }),
        item({ itemId: "item-3", registrationId: "reg-3" }),
      ],
    });
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "gateway",
        itemIds: ["item-3"],
        amountMinor: 25_000n,
      },
    ]);
    expect(plan.supersede).toEqual([]);
    expect(plan.notify).toEqual(["reg-2", "reg-3"]);
  });

  it("supersedes a refund still waiting for finance and refunds its items itself", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "confirmed" },
        { id: "reg-2", standing: "confirmed" },
      ],
      paidBatches: [{ id: "batch-1", method: "gateway" }],
      paidItems: [
        item({
          itemId: "item-1",
          registrationId: "reg-1",
          refund: { kind: "requested", refundId: "refund-9" },
        }),
        item({
          itemId: "item-2",
          registrationId: "reg-2",
          refund: { kind: "requested", refundId: "refund-9" },
        }),
      ],
    });
    expect(plan.supersede).toEqual(["refund-9"]);
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "gateway",
        itemIds: ["item-1", "item-2"],
        amountMinor: 50_000n,
      },
    ]);
  });

  it("asks finance to pay back an offline-paid batch by hand", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [{ id: "reg-1", standing: "confirmed" }],
      paidBatches: [{ id: "batch-1", method: "offline" }],
      paidItems: [item({ itemId: "item-1", registrationId: "reg-1" })],
    });
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "manual",
        itemIds: ["item-1"],
        amountMinor: 25_000n,
      },
    ]);
  });

  it("cancels unpaid registrations and their open batches", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "unpaid" },
        { id: "reg-2", standing: "unpaid" },
      ],
      openBatchIds: ["batch-open"],
    });
    expect(plan.cancelRegistrations).toEqual(["reg-1", "reg-2"]);
    expect(plan.cancelBatches).toEqual(["batch-open"]);
    expect(plan.refunds).toEqual([]);
    expect(plan.notify).toEqual(["reg-1", "reg-2"]);
  });

  it("cancels a free confirmed registration instead of refunding nothing", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-free", standing: "confirmed" },
        { id: "reg-zero", standing: "confirmed" },
      ],
      paidBatches: [{ id: "batch-1", method: "gateway" }],
      paidItems: [
        item({ itemId: "item-0", registrationId: "reg-zero", amountMinor: 0n }),
      ],
    });
    expect(plan.cancelRegistrations).toEqual(["reg-free", "reg-zero"]);
    expect(plan.refunds).toEqual([]);
    expect(plan.notify).toEqual(["reg-free", "reg-zero"]);
  });

  it("leaves withdrawn, refunded and cancelled registrations alone and tells them nothing", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-w", standing: "withdrawn" },
        { id: "reg-r", standing: "refunded" },
        { id: "reg-c", standing: "cancelled" },
      ],
    });
    expect(plan.cancelRegistrations).toEqual([]);
    expect(plan.notify).toEqual([]);
  });

  it("never refunds a batch more than once, whatever order its items come in", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "confirmed" },
        { id: "reg-2", standing: "confirmed" },
        { id: "reg-3", standing: "confirmed" },
      ],
      paidBatches: [
        { id: "batch-1", method: "gateway" },
        { id: "batch-2", method: "gateway" },
      ],
      paidItems: [
        item({ itemId: "item-1", registrationId: "reg-1" }),
        item({ itemId: "item-3", registrationId: "reg-3", batchId: "batch-2" }),
        item({ itemId: "item-2", registrationId: "reg-2" }),
      ],
    });
    expect(plan.refunds.map((refund) => refund.batchId)).toEqual([
      "batch-1",
      "batch-2",
    ]);
    expect(plan.refunds[0]?.itemIds).toEqual(["item-1", "item-2"]);
  });

  it("refunds nothing for a paid batch whose items are all refunded or held", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [{ id: "reg-1", standing: "confirmed" }],
      paidBatches: [{ id: "batch-1", method: "gateway" }],
      paidItems: [
        item({
          itemId: "item-1",
          registrationId: "reg-1",
          refund: { kind: "held" },
        }),
      ],
    });
    expect(plan.refunds).toEqual([]);
    expect(plan.cancelRegistrations).toEqual([]);
    expect(plan.notify).toEqual(["reg-1"]);
  });
});
