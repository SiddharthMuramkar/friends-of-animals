import { describe, expect, it } from "vitest";

import { MAX_BID_RUPEE_DIGITS, parseBidRupees } from "./bid-amount";

describe("parseBidRupees", () => {
  it("reads whole rupees as paise", () => {
    expect(parseBidRupees("1500")).toBe(150_000n);
    expect(parseBidRupees("1")).toBe(100n);
  });

  it("accepts Indian and international digit grouping", () => {
    expect(parseBidRupees("1,500")).toBe(150_000n);
    expect(parseBidRupees("1,50,000")).toBe(15_000_000n);
    expect(parseBidRupees("150,000")).toBe(15_000_000n);
  });

  it("ignores surrounding spaces and a rupee sign or Rs prefix", () => {
    expect(parseBidRupees("  2,000 ")).toBe(200_000n);
    expect(parseBidRupees("₹2,000")).toBe(200_000n);
    expect(parseBidRupees("₹ 2000")).toBe(200_000n);
    expect(parseBidRupees("Rs. 2000")).toBe(200_000n);
    expect(parseBidRupees("rs 2000")).toBe(200_000n);
  });

  it("refuses paise, because bids are in whole rupees", () => {
    expect(parseBidRupees("1500.50")).toBeNull();
    expect(parseBidRupees("1500.00")).toBeNull();
  });

  it("refuses zero, negatives and anything that isn't a number", () => {
    for (const text of [
      "",
      "   ",
      "0",
      "0,000",
      "-500",
      "abc",
      "5e3",
      "1 500",
    ]) {
      expect(parseBidRupees(text)).toBeNull();
    }
  });

  it("refuses commas that don't sit between digits", () => {
    for (const text of [",500", "500,", "1,,500"]) {
      expect(parseBidRupees(text)).toBeNull();
    }
  });

  it("refuses amounts longer than the digit limit, so a slip of the finger can't place a huge binding bid", () => {
    expect(MAX_BID_RUPEE_DIGITS).toBe(9);
    expect(parseBidRupees("999999999")).toBe(99_999_999_900n);
    expect(parseBidRupees("1000000000")).toBeNull();
  });
});
