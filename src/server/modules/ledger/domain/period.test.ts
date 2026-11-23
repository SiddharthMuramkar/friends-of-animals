import { describe, expect, it } from "vitest";

import {
  istDateOf,
  istDateRange,
  isPeriodMonth,
  parseIstDate,
  periodMonthOf,
} from "./period";

describe("periodMonthOf()", () => {
  it("files an instant under its month in India Standard Time", () => {
    // 2026-05-01 00:30 IST.
    expect(periodMonthOf(new Date("2026-04-30T19:00:00Z"))).toBe("2026-05");
  });

  it("turns the month at midnight IST, which is 18:30 UTC", () => {
    expect(periodMonthOf(new Date("2026-04-30T18:29:59.999Z"))).toBe("2026-04");
    expect(periodMonthOf(new Date("2026-04-30T18:30:00.000Z"))).toBe("2026-05");
  });

  it("turns the year the same way", () => {
    expect(periodMonthOf(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01");
  });

  it("refuses an invalid Date", () => {
    expect(() => periodMonthOf(new Date("nope"))).toThrow(RangeError);
  });
});

describe("isPeriodMonth()", () => {
  it.each(["2026-01", "2026-12", "1999-07"])("accepts %s", (value) => {
    expect(isPeriodMonth(value)).toBe(true);
  });

  it.each(["2026-00", "2026-13", "2026-1", "26-01", "2026-01-01", ""])(
    "refuses %j",
    (value) => {
      expect(isPeriodMonth(value)).toBe(false);
    }
  );
});

describe("parseIstDate()", () => {
  it("reads a date as the instant that day starts in IST", () => {
    expect(parseIstDate("2026-05-01")).toEqual({
      ok: true,
      start: new Date("2026-04-30T18:30:00Z"),
    });
  });

  it.each(["2026-02-30", "2026-5-1", "2026-13-01", "01-05-2026", "", "x"])(
    "refuses %j",
    (value) => {
      expect(parseIstDate(value)).toEqual({ ok: false, error: "invalid_date" });
    }
  );
});

describe("istDateOf()", () => {
  it("is the IST calendar date of an instant", () => {
    expect(istDateOf(new Date("2026-04-30T18:29:59Z"))).toBe("2026-04-30");
    expect(istDateOf(new Date("2026-04-30T18:30:00Z"))).toBe("2026-05-01");
  });

  it("round-trips with parseIstDate()", () => {
    const parsed = parseIstDate("2027-01-15");
    expect(parsed.ok && istDateOf(parsed.start)).toBe("2027-01-15");
  });
});

describe("istDateRange()", () => {
  it("covers whole IST days: from the first day's start to the day after the last", () => {
    expect(istDateRange({ from: "2026-05-01", to: "2026-05-31" })).toEqual({
      ok: true,
      fromInclusive: new Date("2026-04-30T18:30:00Z"),
      toExclusive: new Date("2026-05-31T18:30:00Z"),
    });
  });

  it("allows a single day", () => {
    expect(istDateRange({ from: "2026-05-01", to: "2026-05-01" })).toEqual({
      ok: true,
      fromInclusive: new Date("2026-04-30T18:30:00Z"),
      toExclusive: new Date("2026-05-01T18:30:00Z"),
    });
  });

  it("leaves a missing or empty end open", () => {
    expect(istDateRange({})).toEqual({
      ok: true,
      fromInclusive: null,
      toExclusive: null,
    });
    expect(istDateRange({ from: "", to: "2026-05-01" })).toEqual({
      ok: true,
      fromInclusive: null,
      toExclusive: new Date("2026-05-01T18:30:00Z"),
    });
  });

  it("refuses a bad date or an end before the start", () => {
    expect(istDateRange({ from: "2026-02-30" })).toEqual({
      ok: false,
      error: "invalid_date",
    });
    expect(istDateRange({ from: "2026-05-02", to: "2026-05-01" })).toEqual({
      ok: false,
      error: "range_reversed",
    });
  });
});
