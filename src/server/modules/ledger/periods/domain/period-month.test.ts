import { describe, expect, it } from "vitest";

import {
  comparePeriodMonths,
  hasPeriodStarted,
  isPeriodMonth,
  nextPeriodMonth,
  periodMonthOf,
  periodStart,
  previousPeriodMonth,
} from "./period-month";

describe("isPeriodMonth", () => {
  it.each(["2026-11", "2027-01", "1999-12"])("accepts %s", (value) => {
    expect(isPeriodMonth(value)).toBe(true);
  });

  it.each([
    "2026-13",
    "2026-00",
    "2026-1",
    "26-11",
    "2026-11-01",
    "",
    " 2026-11",
  ])("refuses %j", (value) => {
    expect(isPeriodMonth(value)).toBe(false);
  });
});

describe("periodMonthOf (the calendar month in India)", () => {
  it("puts an instant after IST midnight on the 1st in the new month", () => {
    // 2026-05-01 00:30 IST
    expect(periodMonthOf(new Date("2026-04-30T19:00:00.000Z"))).toBe("2026-05");
  });

  it("keeps an instant just before IST midnight in the old month", () => {
    // 2026-04-30 23:59:59.999 IST
    expect(periodMonthOf(new Date("2026-04-30T18:29:59.999Z"))).toBe("2026-04");
  });

  it("crosses the year in India before it does in UTC", () => {
    // 2027-01-01 00:00 IST
    expect(periodMonthOf(new Date("2026-12-31T18:30:00.000Z"))).toBe("2027-01");
  });
});

describe("periodStart", () => {
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
  });
});

describe("hasPeriodStarted", () => {
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
