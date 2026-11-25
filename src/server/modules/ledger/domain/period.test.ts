import { describe, expect, it } from "vitest";

import {
  comparePeriodMonths,
  financialYearMonths,
  hasPeriodStarted,
  istDateOf,
  istDateRange,
  isPeriodMonth,
  monthsBetween,
  nextPeriodMonth,
  parseIstDate,
  periodMonthOf,
  periodStart,
  previousPeriodMonth,
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

describe("periodStart()", () => {
  it("is midnight IST on the 1st", () => {
    expect(periodStart("2026-11").toISOString()).toBe(
      "2026-10-31T18:30:00.000Z"
    );
    expect(periodStart("2027-01").toISOString()).toBe(
      "2026-12-31T18:30:00.000Z"
    );
  });

  it("round-trips with periodMonthOf", () => {
    expect(periodMonthOf(periodStart("2026-02"))).toBe("2026-02");
  });

  it("refuses something that isn't a month", () => {
    expect(() => periodStart("2026-13")).toThrow(RangeError);
  });
});

describe("month arithmetic", () => {
  it("steps forward and back across a year", () => {
    expect(nextPeriodMonth("2026-12")).toBe("2027-01");
    expect(nextPeriodMonth("2026-04")).toBe("2026-05");
    expect(previousPeriodMonth("2027-01")).toBe("2026-12");
    expect(previousPeriodMonth("2026-05")).toBe("2026-04");
  });

  it("orders months", () => {
    expect(comparePeriodMonths("2026-11", "2026-12")).toBeLessThan(0);
    expect(comparePeriodMonths("2027-01", "2026-12")).toBeGreaterThan(0);
    expect(comparePeriodMonths("2026-11", "2026-11")).toBe(0);
    expect(() => comparePeriodMonths("2026-11", "2026-1")).toThrow(RangeError);
  });

  it("lists every month from the first to the last, both included", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(monthsBetween("2026-11", "2026-11")).toEqual(["2026-11"]);
    expect(monthsBetween("2026-11", "2026-10")).toEqual([]);
  });
});

describe("hasPeriodStarted()", () => {
  it("is true from IST midnight on the 1st, so the current month can be locked", () => {
    expect(
      hasPeriodStarted("2026-11", new Date("2026-10-31T18:30:00.000Z"))
    ).toBe(true);
    expect(
      hasPeriodStarted("2026-11", new Date("2026-11-21T10:00:00.000Z"))
    ).toBe(true);
  });

  it("is false a millisecond before", () => {
    expect(
      hasPeriodStarted("2026-11", new Date("2026-10-31T18:29:59.999Z"))
    ).toBe(false);
  });
});

describe("financialYearMonths()", () => {
  const FY_2026_27 = [
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
    "2027-03",
  ];

  it("is April to March of the financial year a month falls in", () => {
    expect(financialYearMonths("2026-11")).toEqual(FY_2026_27);
    expect(financialYearMonths("2026-04")).toEqual(FY_2026_27);
  });

  it("counts January to March in the year that began the April before", () => {
    expect(financialYearMonths("2027-01")).toEqual(FY_2026_27);
    expect(financialYearMonths("2027-03")).toEqual(FY_2026_27);
  });

  it("starts the next year in April", () => {
    expect(financialYearMonths("2027-04")[0]).toBe("2027-04");
    expect(financialYearMonths("2027-04")[11]).toBe("2028-03");
  });
});
