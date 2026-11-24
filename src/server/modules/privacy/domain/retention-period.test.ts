import { describe, expect, it } from "vitest";

import { floorLapsesAt, isExpired, minimumFloorDays } from "./retention-period";

describe("isExpired", () => {
  const anchor = new Date("2027-01-01T00:00:00.000Z");

  it("keeps a row for exactly its period, then lets it go", () => {
    expect(
      isExpired({
        anchor,
        now: new Date("2027-01-30T23:59:59.999Z"),
        days: 30,
      })
    ).toBe(false);
    expect(
      isExpired({ anchor, now: new Date("2027-01-31T00:00:00.000Z"), days: 30 })
    ).toBe(true);
  });

  it("never lets a row go before a days floor that outlasts the setting", () => {
    const now = new Date("2027-02-15T00:00:00.000Z");
    expect(
      isExpired({ anchor, now, days: 30, floor: { kind: "days", days: 90 } })
    ).toBe(false);
    expect(
      isExpired({
        anchor,
        now: new Date("2027-04-01T00:00:00.000Z"),
        days: 30,
        floor: { kind: "days", days: 90 },
      })
    ).toBe(true);
  });

  it("holds a financial record until its financial-year floor lapses", () => {
    const floor = { kind: "financial_years", years: 8 } as const;
    const payment = new Date("2026-05-10T06:00:00.000Z");
    expect(
      isExpired({
        anchor: payment,
        now: new Date("2035-03-31T18:29:59.999Z"),
        days: 30,
        floor,
      })
    ).toBe(false);
    expect(
      isExpired({
        anchor: payment,
        now: new Date("2035-03-31T18:30:00.000Z"),
        days: 30,
        floor,
      })
    ).toBe(true);
  });
});

describe("floorLapsesAt", () => {
  const eightYears = { kind: "financial_years", years: 8 } as const;

  it("counts 8 years from the end of the IST financial year", () => {
    // 10 May 2026 is in FY 2026-27, which ends on 31 March 2027 (IST).
    expect(
      floorLapsesAt(new Date("2026-05-10T06:00:00.000Z"), eightYears)
    ).toEqual(new Date("2035-03-31T18:30:00.000Z"));
  });

  it("puts 31 March in IST in the year that is ending", () => {
    // 31 March 2027, 23:00 IST: still FY 2026-27.
    expect(
      floorLapsesAt(new Date("2027-03-31T17:30:00.000Z"), eightYears)
    ).toEqual(new Date("2035-03-31T18:30:00.000Z"));
  });

  it("puts 1 April in IST in the next year, though UTC still says March", () => {
    // 1 April 2027, 00:30 IST is 31 March 2027, 19:00 UTC: FY 2027-28.
    expect(
      floorLapsesAt(new Date("2027-03-31T19:00:00.000Z"), eightYears)
    ).toEqual(new Date("2036-03-31T18:30:00.000Z"));
  });

  it("adds whole days for a days floor", () => {
    expect(
      floorLapsesAt(new Date("2027-01-01T10:00:00.000Z"), {
        kind: "days",
        days: 90,
      })
    ).toEqual(new Date("2027-04-01T10:00:00.000Z"));
  });
});

describe("minimumFloorDays", () => {
  it("is the days of a days floor", () => {
    expect(minimumFloorDays({ kind: "days", days: 90 })).toBe(90);
  });

  it("is the shortest a financial-year floor can be, leap days included", () => {
    // A record made on 31 March waits only the 8 years after it.
    expect(minimumFloorDays({ kind: "financial_years", years: 8 })).toBe(2922);
  });

  it("is 1 when there is no floor", () => {
    expect(minimumFloorDays(undefined)).toBe(1);
  });
});
