import { describe, expect, it } from "vitest";

import {
  MAX_RECEIPT_SEQUENCE,
  financialYearOf,
  formatReceiptNumber,
  parseReceiptNumber,
} from "./receipt-number";

describe("financialYearOf", () => {
  it.each([
    // 1 April 00:00 IST is 31 March 18:30 UTC.
    ["2027-03-31T18:29:59.999Z", 2026, "2627"],
    ["2027-03-31T18:30:00.000Z", 2027, "2728"],
    // 31 March 23:59 IST on the last day of FY 2026-27.
    ["2027-03-31T18:29:00.000Z", 2026, "2627"],
    // Mid-year and January belong to the year that started in April.
    ["2026-11-21T06:00:00.000Z", 2026, "2627"],
    ["2027-01-15T04:30:00.000Z", 2026, "2627"],
    ["2026-04-01T00:00:00.000Z", 2026, "2627"],
    ["2026-03-31T18:29:59.999Z", 2025, "2526"],
    // The century turn keeps two digits each.
    ["2099-06-01T00:00:00.000Z", 2099, "9900"],
    ["2100-01-01T00:00:00.000Z", 2099, "9900"],
  ])("%s is FY %i (%s)", (instant, startYear, token) => {
    expect(financialYearOf(new Date(instant))).toEqual({ startYear, token });
  });

  it("refuses an invalid date", () => {
    expect(() => financialYearOf(new Date("nope"))).toThrow(RangeError);
  });
});

describe("formatReceiptNumber", () => {
  it.each([
    ["2627", 1, "FOA-RCPT-2627-000001"],
    ["2627", 2, "FOA-RCPT-2627-000002"],
    ["2728", 1, "FOA-RCPT-2728-000001"],
    ["2627", 123456, "FOA-RCPT-2627-123456"],
    ["2627", MAX_RECEIPT_SEQUENCE, "FOA-RCPT-2627-999999"],
  ])("FY %s number %i is %s", (fy, seq, expected) => {
    expect(formatReceiptNumber(fy, seq)).toBe(expected);
  });

  it.each([0, -1, 1.5, MAX_RECEIPT_SEQUENCE + 1, Number.NaN])(
    "refuses sequence %s",
    (seq) => {
      expect(() => formatReceiptNumber("2627", seq)).toThrow(RangeError);
    }
  );

  it.each(["262", "26-27", "2628", "abcd", ""])("refuses FY token %j", (fy) => {
    expect(() => formatReceiptNumber(fy, 1)).toThrow(RangeError);
  });
});

describe("parseReceiptNumber", () => {
  it("reads a number back", () => {
    expect(parseReceiptNumber("FOA-RCPT-2627-000042")).toEqual({
      fy: "2627",
      seq: 42,
    });
  });

  it("forgives spaces and lower case, as donors type it", () => {
    expect(parseReceiptNumber("  foa-rcpt-2728-000001 ")).toEqual({
      fy: "2728",
      seq: 1,
    });
  });

  it.each([
    "FOA-RCPT-2627-00001",
    "FOA-RCPT-2627-0000001",
    "FOA-RCPT-2627-000000",
    "FOA-RCPT-2628-000001",
    "FOA-C-26-000001",
    "RCPT-2627-000001",
    "",
  ])("refuses %j", (input) => {
    expect(parseReceiptNumber(input)).toBeNull();
  });

  it("round-trips with formatReceiptNumber", () => {
    for (const seq of [1, 9, 10, 99_999, 100_000, MAX_RECEIPT_SEQUENCE]) {
      expect(parseReceiptNumber(formatReceiptNumber("2627", seq))).toEqual({
        fy: "2627",
        seq,
      });
    }
  });
});
