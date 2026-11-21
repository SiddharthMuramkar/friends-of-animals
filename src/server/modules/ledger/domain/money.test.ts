import { describe, expect, it } from "vitest";

import { MAX_ENTRY_AMOUNT_MINOR, parseRupees, rupeesForInput } from "./money";

describe("parseRupees()", () => {
  it.each([
    ["1", 100n],
    ["1234", 123400n],
    ["1234.5", 123450n],
    ["1234.05", 123405n],
    ["0.01", 1n],
    ["1,23,456.78", 12345678n],
    ["123,456", 12345600n],
    ["  ₹ 2,500 ", 250000n],
    ["Rs 2500", 250000n],
    ["Rs. 2500.00", 250000n],
    ["007", 700n],
  ])("reads %j as %s paise", (input, paise) => {
    expect(parseRupees(input)).toEqual({ ok: true, amountMinor: paise });
  });

  it.each([
    "",
    "abc",
    "-5",
    "+5",
    "1.234",
    "1.",
    ".5",
    "1,,000",
    ",100",
    "100,",
    "1e5",
    "1 000",
    "₹",
    "12.3.4",
  ])("refuses %j", (input) => {
    expect(parseRupees(input)).toEqual({ ok: false, error: "invalid_amount" });
  });

  it("refuses zero", () => {
    expect(parseRupees("0")).toEqual({ ok: false, error: "not_positive" });
    expect(parseRupees("0.00")).toEqual({ ok: false, error: "not_positive" });
  });

  it("refuses more than the entry limit, a guard against typos", () => {
    expect(MAX_ENTRY_AMOUNT_MINOR).toBe(100_000_000_000n); // Rs 100 crore
    expect(parseRupees("100,00,00,000")).toEqual({
      ok: true,
      amountMinor: MAX_ENTRY_AMOUNT_MINOR,
    });
    expect(parseRupees("100,00,00,000.01")).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("keeps every paisa of a large amount (no floating point)", () => {
    expect(parseRupees("99,99,99,999.99")).toEqual({
      ok: true,
      amountMinor: 99_999_999_999n,
    });
  });
});

describe("rupeesForInput()", () => {
  it.each([
    [1n, "0.01"],
    [100n, "1.00"],
    [123450n, "1234.50"],
    [9_999_999_999_99n, "9999999999.99"],
  ])("writes %s paise as %j", (paise, text) => {
    expect(rupeesForInput(paise)).toBe(text);
  });

  it("round-trips with parseRupees()", () => {
    for (const paise of [1n, 99n, 100n, 123456789n]) {
      expect(parseRupees(rupeesForInput(paise))).toEqual({
        ok: true,
        amountMinor: paise,
      });
    }
  });

  it("refuses a negative amount", () => {
    expect(() => rupeesForInput(-1n)).toThrow(RangeError);
  });
});
