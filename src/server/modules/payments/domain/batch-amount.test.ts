import { describe, expect, it } from "vitest";

import { batchTotal } from "./batch-amount";

const inr = (amountMinor: bigint) => ({ amountMinor, currency: "INR" });

describe("batchTotal()", () => {
  it("adds up the items of a batch in paise", () => {
    expect(batchTotal([inr(15_000n), inr(15_000n), inr(15_000n)])).toEqual({
      ok: true,
      total: { amountMinor: 45_000n, currency: "INR" },
    });
  });

  it("is the item's own amount for a batch of one", () => {
    expect(batchTotal([inr(49_900n)])).toEqual({
      ok: true,
      total: { amountMinor: 49_900n, currency: "INR" },
    });
  });

  it("stays exact past 2^53 paise, where numbers would round", () => {
    const big = 2n ** 53n + 1n;
    expect(batchTotal([inr(big), inr(1n)])).toEqual({
      ok: true,
      total: { amountMinor: big + 1n, currency: "INR" },
    });
  });

  it("totals zero for a free competition, so it confirms without an order", () => {
    expect(batchTotal([inr(0n), inr(0n)])).toEqual({
      ok: true,
      total: { amountMinor: 0n, currency: "INR" },
    });
  });

  it("refuses an empty batch", () => {
    expect(batchTotal([])).toEqual({ ok: false, reason: "empty_batch" });
  });

  it("refuses a negative item", () => {
    expect(batchTotal([inr(15_000n), inr(-1n)])).toEqual({
      ok: false,
      reason: "negative_amount",
    });
  });

  it("refuses any currency but INR while FOA takes domestic payments only", () => {
    expect(
      batchTotal([inr(15_000n), { amountMinor: 1_000n, currency: "USD" }])
    ).toEqual({ ok: false, reason: "unsupported_currency" });
    expect(batchTotal([{ amountMinor: 1_000n, currency: "inr" }])).toEqual({
      ok: false,
      reason: "unsupported_currency",
    });
  });
});
