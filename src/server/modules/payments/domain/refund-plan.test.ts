import { describe, expect, it } from "vitest";

import { planRefund, type RefundableBatch } from "./refund-plan";

/** A paid batch of three students at ₹250, ₹250 and ₹400. */
function batch(overrides: Partial<RefundableBatch> = {}): RefundableBatch {
  return {
    captured: true,
    amountMinor: 90_000n,
    currency: "INR",
    items: [
      { id: "reg-a", amountMinor: 25_000n, refund: "none" },
      { id: "reg-b", amountMinor: 25_000n, refund: "none" },
      { id: "reg-c", amountMinor: 40_000n, refund: "none" },
    ],
    ...overrides,
  };
}

describe("planRefund()", () => {
  it("refunds every item of a whole batch for the amount captured", () => {
    expect(planRefund(batch(), {})).toEqual({
      ok: true,
      registrationIds: ["reg-a", "reg-b", "reg-c"],
      amountMinor: 90_000n,
      currency: "INR",
    });
  });

  it("refunds only the listed items of a partial refund", () => {
    expect(planRefund(batch(), { registrationIds: ["reg-c", "reg-a"] })).toEqual({
      ok: true,
      registrationIds: ["reg-c", "reg-a"],
      amountMinor: 65_000n,
      currency: "INR",
    });
  });

  it("takes only what is left when a whole-batch request follows a partial refund", () => {
    const partlyRefunded = batch({
      items: [
        { id: "reg-a", amountMinor: 25_000n, refund: "refunded" },
        { id: "reg-b", amountMinor: 25_000n, refund: "live" },
        { id: "reg-c", amountMinor: 40_000n, refund: "none" },
      ],
    });
    expect(planRefund(partlyRefunded, {})).toEqual({
      ok: true,
      registrationIds: ["reg-c"],
      amountMinor: 40_000n,
      currency: "INR",
    });
  });

  it("refuses a batch that was never paid", () => {
    expect(planRefund(batch({ captured: false }), {})).toEqual({
      ok: false,
      reason: "batch_not_captured",
    });
  });

  it("refuses an empty list of items", () => {
    expect(planRefund(batch(), { registrationIds: [] })).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("refuses an item listed twice", () => {
    expect(planRefund(batch(), { registrationIds: ["reg-a", "reg-a"] })).toEqual({
      ok: false,
      reason: "duplicate_item",
      registrationId: "reg-a",
    });
  });

  it("refuses an item from another batch", () => {
    expect(planRefund(batch(), { registrationIds: ["reg-a", "reg-z"] })).toEqual({
      ok: false,
      reason: "unknown_item",
      registrationId: "reg-z",
    });
  });

  it("refuses an item another refund already holds", () => {
    const held = batch({
      items: [{ id: "reg-a", amountMinor: 25_000n, refund: "live" }],
    });
    expect(planRefund(held, { registrationIds: ["reg-a"] })).toEqual({
      ok: false,
      reason: "item_in_live_refund",
      registrationId: "reg-a",
    });
  });

  it("refuses an item that was already refunded", () => {
    const refunded = batch({
      items: [{ id: "reg-a", amountMinor: 25_000n, refund: "refunded" }],
    });
    expect(planRefund(refunded, { registrationIds: ["reg-a"] })).toEqual({
      ok: false,
      reason: "item_already_refunded",
      registrationId: "reg-a",
    });
  });

  it("has nothing to refund once every item is refunded or held", () => {
    const done = batch({
      items: [
        { id: "reg-a", amountMinor: 25_000n, refund: "refunded" },
        { id: "reg-b", amountMinor: 25_000n, refund: "live" },
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
      items: [{ id: "reg-a", amountMinor: 0n, refund: "none" }],
    });
    expect(planRefund(free, { registrationIds: ["reg-a"] })).toEqual({
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
        { id: "reg-a", amountMinor: 25_000n, refund: "refunded" },
        { id: "reg-b", amountMinor: 25_000n, refund: "live" },
        { id: "reg-c", amountMinor: 25_000n, refund: "none" },
      ],
    });
    expect(planRefund(inconsistent, { registrationIds: ["reg-c"] })).toEqual({
      ok: false,
      reason: "exceeds_paid",
    });
  });
});
