import { describe, expect, it } from "vitest";

import { formatCapturedAmount, formatPaise } from "./money-format";

describe("formatPaise", () => {
  it.each([
    [0n, "₹0.00"],
    [5n, "₹0.05"],
    [100_000n, "₹1,000.00"],
    [150_050n, "₹1,500.50"],
    [1_24_00_000_00n, "₹1,24,00,000.00"],
    // Beyond a float's exact integers: still to the paisa.
    [9_007_199_254_740_993n, "₹9,00,71,99,25,47,409.93"],
  ])("writes %s paise as %s", (paise, words) => {
    expect(formatPaise(paise)).toBe(words);
  });
});

describe("formatCapturedAmount", () => {
  it.each([
    [1200n, "USD", "USD\u00a012.00"],
    [1200n, "JPY", "JPY\u00a01,200"],
    [1200n, "KWD", "KWD\u00a01.200"],
    [9_007_199_254_740_993n, "KWD", "KWD\u00a090,07,19,92,54,740.993"],
  ])("formats %s minor units in %s", (amount, currency, words) => {
    expect(formatCapturedAmount(amount, currency)).toBe(words);
  });
});
