import { describe, expect, it } from "vitest";

import { planRefund, type RefundableBatch } from "./refund-plan";

/** A paid batch of three students at ₹250, ₹250 and ₹400. */
function batch(overrides: Partial<RefundableBatch> = {}): RefundableBatch {
  return {
    paid: true,
    amountMinor: 90_000n,
    currency: "INR",
    items: [
      { id: "item-a", amountMinor: 25_000n, refund: "none" },
      { id: "item-b", amountMinor: 25_000n, refund: "none" },
      { id: "item-c", amountMinor: 40_000n, refund: "none" },
    ],
    ...overrides,
  };
}

describe("planRefund()", () => {
  it("refunds every item of a whole batch for the amount captured", () => {
    expect(planRefund(batch(), {})).toEqual({
      ok: true,
      itemIds: ["item-a", "item-b", "item-c"],
      amountMinor: 90_000n,
      currency: "INR",
    });
  });

  it("refunds only the listed items of a partial refund", () => {
    expect(planRefund(batch(), { itemIds: ["item-c", "item-a"] })).toEqual({
      ok: true,
      itemIds: ["item-c", "item-a"],
      amountMinor: 65_000n,
      currency: "INR",
    });
  });

  it("takes only what is left when a whole-batch request follows a partial refund", () => {
    const partlyRefunded = batch({
      items: [
        { id: "item-a", amountMinor: 25_000n, refund: "refunded" },
        { id: "item-b", amountMinor: 25_000n, refund: "live" },
        { id: "item-c", amountMinor: 40_000n, refund: "none" },
      ],
    });
    expect(planRefund(partlyRefunded, {})).toEqual({
      ok: true,
      itemIds: ["item-c"],
      amountMinor: 40_000n,
      currency: "INR",
    });
  });

  it("refuses a batch that was never paid", () => {
    expect(planRefund(batch({ paid: false }), {})).toEqual({
      ok: false,
      reason: "batch_not_paid",
    });
  });

  it("refuses an empty list of items", () => {
    expect(planRefund(batch(), { itemIds: [] })).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("refuses an item listed twice", () => {
    expect(planRefund(batch(), { itemIds: ["item-a", "item-a"] })).toEqual({
      ok: false,
      reason: "duplicate_item",
      itemId: "item-a",
    });
  });

  it("refuses an item from another batch", () => {
    expect(planRefund(batch(), { itemIds: ["item-a", "item-z"] })).toEqual({
      ok: false,
      reason: "unknown_item",
      itemId: "item-z",
    });
  });

  it("refuses an item another refund already holds", () => {
    const held = batch({
      items: [{ id: "item-a", amountMinor: 25_000n, refund: "live" }],
    });
    expect(planRefund(held, { itemIds: ["item-a"] })).toEqual({
      ok: false,
      reason: "item_in_live_refund",
      itemId: "item-a",
    });
  });

  it("refuses an item that was already refunded", () => {
    const refunded = batch({
      items: [{ id: "item-a", amountMinor: 25_000n, refund: "refunded" }],
    });
    expect(planRefund(refunded, { itemIds: ["item-a"] })).toEqual({
      ok: false,
      reason: "item_already_refunded",
      itemId: "item-a",
    });
  });

  it("has nothing to refund once every item is refunded or held", () => {
    const done = batch({
      items: [
        { id: "item-a", amountMinor: 25_000n, refund: "refunded" },
        { id: "item-b", amountMinor: 25_000n, refund: "live" },
      ],
    });
    expect(planRefund(done, {})).toEqual({
      ok: false,
      reason: "nothing_to_refund",
    });
  });

  it("has nothing to refund for items that were free", () => {
    const free = batch({
      amountMinor: 0n,
      items: [{ id: "item-a", amountMinor: 0n, refund: "none" }],
    });
    expect(planRefund(free, { itemIds: ["item-a"] })).toEqual({
      ok: false,
      reason: "nothing_to_refund",
    });
  });

  it("never returns more than the batch captured, even if the items disagree", () => {
    const inconsistent = batch({ amountMinor: 50_000n });
    expect(planRefund(inconsistent, {})).toEqual({
      ok: false,
      reason: "exceeds_paid",
    });
  });

  it("counts refunded and held items against what the batch captured", () => {
    const inconsistent = batch({
      amountMinor: 60_000n,
      items: [
        { id: "item-a", amountMinor: 25_000n, refund: "refunded" },
        { id: "item-b", amountMinor: 25_000n, refund: "live" },
        { id: "item-c", amountMinor: 25_000n, refund: "none" },
      ],
    });
    expect(planRefund(inconsistent, { itemIds: ["item-c"] })).toEqual({
      ok: false,
      reason: "exceeds_paid",
    });
  });
});
