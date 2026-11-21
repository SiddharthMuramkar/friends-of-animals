import { describe, expect, it } from "vitest";

import {
  MAX_RANGE_DAYS,
  addDays,
  defaultPeriod,
  formatPeriodParam,
  granularityFor,
  isCalendarDay,
  istDateOf,
  istMidnight,
  parsePeriodParam,
  previousPeriod,
  resolvePeriod,
  splitPeriod,
  type PeriodChoice,
  type ResolvedPeriod,
} from "./period";

// 10:00 IST on 15 January 2027, the harness's default instant.
const NOW = new Date("2027-01-15T04:30:00.000Z");

function resolved(choice: PeriodChoice, now = NOW): ResolvedPeriod {
  const result = resolvePeriod(choice, now);
  if (!result.ok) throw new Error(`expected a period, got ${result.reason}`);
  return result.period;
}

describe("IST calendar days", () => {
  it.each([
    // 00:00 IST is 18:30 UTC the evening before.
    ["2027-01-14T18:29:59.999Z", "2027-01-14"],
    ["2027-01-14T18:30:00.000Z", "2027-01-15"],
    ["2027-01-15T18:29:59.999Z", "2027-01-15"],
    ["2026-12-31T18:30:00.000Z", "2027-01-01"],
  ])("%s falls on %s in IST", (instant, day) => {
    expect(istDateOf(new Date(instant))).toBe(day);
  });

  it("starts a day at 00:00 IST", () => {
    expect(istMidnight("2027-01-15").toISOString()).toBe(
      "2027-01-14T18:30:00.000Z"
    );
    expect(istMidnight("2026-04-01").toISOString()).toBe(
      "2026-03-31T18:30:00.000Z"
    );
  });

  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDays("2027-01-31", 1)).toBe("2027-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2027-01-15", 0)).toBe("2027-01-15");
  });

  it("tells a real calendar day from a malformed or impossible one", () => {
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2027-02-29")).toBe(false);
    expect(isCalendarDay("2027-1-15")).toBe(false);
  });

  it("refuses a malformed or impossible day", () => {
    expect(() => istMidnight("2027-02-30")).toThrow(RangeError);
    expect(() => addDays("15/01/2027", 1)).toThrow(RangeError);
  });
});

describe("parsePeriodParam and formatPeriodParam", () => {
  const cases: [string, PeriodChoice][] = [
    ["2026-12", { kind: "month", year: 2026, month: 12 }],
    ["fy2026-27", { kind: "fy", fyStartYear: 2026 }],
    ["fy2026-27-q3", { kind: "quarter", fyStartYear: 2026, quarter: 3 }],
    ["fy2099-00", { kind: "fy", fyStartYear: 2099 }],
    [
      "2026-10-01_2026-12-31",
      { kind: "range", from: "2026-10-01", to: "2026-12-31" },
    ],
  ];

  it.each(cases)("reads %s", (param, choice) => {
    expect(parsePeriodParam(param)).toEqual(choice);
  });

  it.each(cases)("writes %s back", (param, choice) => {
    expect(formatPeriodParam(choice)).toBe(param);
  });

  it.each([
    "",
    "2026-13",
    "2026-00",
    "fy2026-28",
    "fy2026",
    "fy2026-27-q5",
    "fy2026-27-q0",
    "2026-02-30_2026-03-01",
    "2026-10-01..2026-12-31",
    "2026-10-01_",
    "month",
    " 2026-12",
  ])("refuses %j", (param) => {
    expect(parsePeriodParam(param)).toBeNull();
  });
});

describe("resolvePeriod", () => {
  it("resolves a whole past month to IST-bounded instants", () => {
    expect(resolved({ kind: "month", year: 2026, month: 12 })).toEqual({
      choice: { kind: "month", year: 2026, month: 12 },
      from: "2026-12-01",
      to: "2026-12-31",
      nominalTo: "2026-12-31",
      start: new Date("2026-11-30T18:30:00.000Z"),
      end: new Date("2026-12-31T18:30:00.000Z"),
      days: 31,
      partial: false,
    });
  });

  it("covers a month only up to today while it is running", () => {
    const january = resolved({ kind: "month", year: 2027, month: 1 });
    expect(january).toMatchObject({
      from: "2027-01-01",
      to: "2027-01-15",
      nominalTo: "2027-01-31",
      days: 15,
      partial: true,
    });
    // The end is the start of tomorrow in IST, so today's rows count.
    expect(january.end.toISOString()).toBe("2027-01-15T18:30:00.000Z");
  });

  it("counts February's days in leap and common years", () => {
    expect(resolved({ kind: "month", year: 2024, month: 2 }).days).toBe(29);
    expect(resolved({ kind: "month", year: 2026, month: 2 }).days).toBe(28);
  });

  it.each([
    [1, "2026-04-01", "2026-06-30"],
    [2, "2026-07-01", "2026-09-30"],
    [3, "2026-10-01", "2026-12-31"],
  ] as const)(
    "puts quarter %i of FY 2026-27 at %s..%s",
    (quarter, from, to) => {
      expect(
        resolved({ kind: "quarter", fyStartYear: 2026, quarter })
      ).toMatchObject({ from, to, nominalTo: to, partial: false });
    }
  );

  it("runs quarter 4 into the next calendar year", () => {
    expect(
      resolved(
        { kind: "quarter", fyStartYear: 2025, quarter: 4 },
        new Date("2026-06-01T00:00:00.000Z")
      )
    ).toMatchObject({ from: "2026-01-01", to: "2026-03-31", days: 90 });
  });

  it("runs a financial year from 1 April to 31 March", () => {
    expect(
      resolved(
        { kind: "fy", fyStartYear: 2025 },
        new Date("2026-06-01T00:00:00.000Z")
      )
    ).toMatchObject({
      from: "2025-04-01",
      to: "2026-03-31",
      days: 365,
      partial: false,
      start: new Date("2025-03-31T18:30:00.000Z"),
      end: new Date("2026-03-31T18:30:00.000Z"),
    });
    expect(resolved({ kind: "fy", fyStartYear: 2026 })).toMatchObject({
      from: "2026-04-01",
      to: "2027-01-15",
      nominalTo: "2027-03-31",
      partial: true,
    });
  });

  it("takes a custom range of whole days, both ends included", () => {
    expect(
      resolved({ kind: "range", from: "2026-11-10", to: "2026-11-10" })
    ).toMatchObject({ from: "2026-11-10", to: "2026-11-10", days: 1 });
  });

  it("refuses a range that ends before it starts", () => {
    expect(
      resolvePeriod(
        { kind: "range", from: "2026-11-10", to: "2026-11-09" },
        NOW
      )
    ).toEqual({ ok: false, reason: "invalid_range" });
  });

  it("refuses a malformed day in a range", () => {
    expect(
      resolvePeriod(
        { kind: "range", from: "2026-11-31", to: "2026-12-01" },
        NOW
      )
    ).toEqual({ ok: false, reason: "invalid_range" });
  });

  it("refuses a period that starts after today", () => {
    expect(resolvePeriod({ kind: "month", year: 2027, month: 2 }, NOW)).toEqual(
      { ok: false, reason: "period_in_future" }
    );
    expect(
      resolvePeriod(
        { kind: "range", from: "2027-01-16", to: "2027-01-20" },
        NOW
      )
    ).toEqual({ ok: false, reason: "period_in_future" });
  });

  it("accepts a period that starts today", () => {
    expect(
      resolved({ kind: "range", from: "2027-01-15", to: "2027-02-15" })
    ).toMatchObject({ to: "2027-01-15", days: 1, partial: true });
  });

  it(`refuses a custom range over ${MAX_RANGE_DAYS} days`, () => {
    const from = "2023-01-01";
    expect(
      resolved({ kind: "range", from, to: addDays(from, MAX_RANGE_DAYS - 1) })
        .days
    ).toBe(MAX_RANGE_DAYS);
    expect(
      resolvePeriod(
        { kind: "range", from, to: addDays(from, MAX_RANGE_DAYS) },
        NOW
      )
    ).toEqual({ ok: false, reason: "range_too_long" });
  });

  it("refuses an impossible month, quarter or year", () => {
    for (const choice of [
      { kind: "month", year: 2026, month: 13 },
      { kind: "month", year: 2026, month: 0 },
      { kind: "quarter", fyStartYear: 2026, quarter: 5 },
      { kind: "fy", fyStartYear: 1899 },
      { kind: "fy", fyStartYear: 2026.5 },
    ] as unknown as PeriodChoice[]) {
      expect(resolvePeriod(choice, NOW)).toEqual({
        ok: false,
        reason: "invalid_period",
      });
    }
  });
});

describe("defaultPeriod", () => {
  it("is the financial year so far", () => {
    expect(defaultPeriod(NOW)).toEqual({ kind: "fy", fyStartYear: 2026 });
    // 1 April 00:00 IST opens the next year.
    expect(defaultPeriod(new Date("2027-03-31T18:30:00.000Z"))).toEqual({
      kind: "fy",
      fyStartYear: 2027,
    });
    expect(defaultPeriod(new Date("2027-03-31T18:29:59.999Z"))).toEqual({
      kind: "fy",
      fyStartYear: 2026,
    });
  });
});

describe("previousPeriod", () => {
  it("compares a whole month with the whole month before", () => {
    const previous = previousPeriod(
      resolved({ kind: "month", year: 2026, month: 12 })
    );
    expect(previous).toMatchObject({
      choice: { kind: "month", year: 2026, month: 11 },
      from: "2026-11-01",
      to: "2026-11-30",
      days: 30,
      partial: false,
    });
    expect(previous.end.toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });

  it("compares a running month with the same days of the month before", () => {
    expect(
      previousPeriod(resolved({ kind: "month", year: 2027, month: 1 }))
    ).toMatchObject({
      choice: { kind: "month", year: 2026, month: 12 },
      from: "2026-12-01",
      to: "2026-12-15",
      nominalTo: "2026-12-31",
      days: 15,
      partial: true,
    });
  });

  it("stops at the end of a shorter month before", () => {
    const march31 = new Date("2027-03-31T04:30:00.000Z");
    expect(
      previousPeriod(resolved({ kind: "month", year: 2027, month: 3 }, march31))
    ).toMatchObject({ from: "2027-02-01", to: "2027-02-28", days: 28 });
  });

  it("goes from quarter 1 back to quarter 4 of the year before", () => {
    expect(
      previousPeriod(
        resolved(
          { kind: "quarter", fyStartYear: 2026, quarter: 1 },
          new Date("2026-08-01T00:00:00.000Z")
        )
      )
    ).toMatchObject({
      choice: { kind: "quarter", fyStartYear: 2025, quarter: 4 },
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("compares a year so far with the same stretch of the year before", () => {
    expect(
      previousPeriod(resolved({ kind: "fy", fyStartYear: 2026 }))
    ).toMatchObject({
      choice: { kind: "fy", fyStartYear: 2025 },
      from: "2025-04-01",
      to: "2026-01-15",
      days: 290,
    });
  });

  it("puts an equal run of days straight before a custom range", () => {
    expect(
      previousPeriod(
        resolved({ kind: "range", from: "2026-11-10", to: "2026-11-19" })
      )
    ).toMatchObject({
      choice: { kind: "range", from: "2026-10-31", to: "2026-11-09" },
      from: "2026-10-31",
      to: "2026-11-09",
      days: 10,
      partial: false,
    });
  });

  it("matches a running custom range by the days covered so far", () => {
    // The 21 days before 11 January start on 21 December; 5 have run.
    expect(
      previousPeriod(
        resolved({ kind: "range", from: "2027-01-11", to: "2027-01-31" })
      )
    ).toMatchObject({
      choice: { kind: "range", from: "2026-12-21", to: "2027-01-10" },
      from: "2026-12-21",
      to: "2026-12-25",
      days: 5,
      partial: true,
    });
  });
});

describe("granularityFor", () => {
  it("shows up to 92 days by week and longer periods by month", () => {
    expect(granularityFor(1)).toBe("week");
    expect(granularityFor(92)).toBe("week");
    expect(granularityFor(93)).toBe("month");
    expect(granularityFor(MAX_RANGE_DAYS)).toBe("month");
  });
});

describe("splitPeriod", () => {
  it("cuts a period into Monday-to-Sunday weeks, clipped at both ends", () => {
    // 1 December 2026 is a Tuesday; 31 December a Thursday.
    expect(
      splitPeriod(resolved({ kind: "month", year: 2026, month: 12 }), "week")
    ).toEqual([
      { from: "2026-12-01", to: "2026-12-06" },
      { from: "2026-12-07", to: "2026-12-13" },
      { from: "2026-12-14", to: "2026-12-20" },
      { from: "2026-12-21", to: "2026-12-27" },
      { from: "2026-12-28", to: "2026-12-31" },
    ]);
  });

  it("cuts a period into calendar months, ending at today", () => {
    expect(
      splitPeriod(resolved({ kind: "fy", fyStartYear: 2026 }), "month")
    ).toHaveLength(10);
    expect(
      splitPeriod(
        resolved({ kind: "range", from: "2026-11-20", to: "2027-01-31" }),
        "month"
      )
    ).toEqual([
      { from: "2026-11-20", to: "2026-11-30" },
      { from: "2026-12-01", to: "2026-12-31" },
      { from: "2027-01-01", to: "2027-01-15" },
    ]);
  });

  it("gives one bucket for a single day", () => {
    expect(
      splitPeriod(
        resolved({ kind: "range", from: "2027-01-13", to: "2027-01-13" }),
        "week"
      )
    ).toEqual([{ from: "2027-01-13", to: "2027-01-13" }]);
  });

  it("starts weeks on Mondays before 1970 too", () => {
    // 1 January 1960 was a Friday; 4 January the Monday after.
    expect(
      splitPeriod(
        resolved({ kind: "range", from: "1960-01-01", to: "1960-01-12" }),
        "week"
      )
    ).toEqual([
      { from: "1960-01-01", to: "1960-01-03" },
      { from: "1960-01-04", to: "1960-01-10" },
      { from: "1960-01-11", to: "1960-01-12" },
    ]);
  });
});
