import { describe, expect, it } from "vitest";

import {
  financialYearMonths,
  monthsBetween,
  resolveMonthRange,
} from "./months";

describe("monthsBetween", () => {
  it("lists every month from the first to the last, both included", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("is the one month when both ends are the same", () => {
    expect(monthsBetween("2026-11", "2026-11")).toEqual(["2026-11"]);
  });

  it("is empty when the range ends before it starts", () => {
    expect(monthsBetween("2026-11", "2026-10")).toEqual([]);
  });
});

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

describe("financialYearMonths", () => {
  it("is April to March of the financial year a month falls in", () => {
    expect(financialYearMonths("2026-11")).toEqual(FY_2026_27);
  });

  it("counts January to March in the year that began the April before", () => {
    expect(financialYearMonths("2027-01")).toEqual(FY_2026_27);
    expect(financialYearMonths("2027-03")).toEqual(FY_2026_27);
  });

  it("starts the next year in April", () => {
    expect(financialYearMonths("2026-04")).toEqual(FY_2026_27);
    expect(financialYearMonths("2027-04")[0]).toBe("2027-04");
    expect(financialYearMonths("2027-04")[11]).toBe("2028-03");
  });
});

describe("resolveMonthRange", () => {
  const NOW = new Date("2026-11-21T06:00:00.000Z");

  it("is the months asked for", () => {
    expect(resolveMonthRange({ from: "2026-10", to: "2026-11" }, NOW)).toEqual(
      { ok: true, months: ["2026-10", "2026-11"] }
    );
  });

  it("defaults to the financial year it is now in India", () => {
    expect(resolveMonthRange(undefined, NOW)).toEqual({
      ok: true,
      months: FY_2026_27,
    });
  });

  it("moves to the next financial year at midnight on 1 April in India", () => {
    // 18:30 UTC on 31 March is 00:00 on 1 April at IST.
    const before = resolveMonthRange(
      undefined,
      new Date("2027-03-31T18:29:59.999Z")
    );
    const after = resolveMonthRange(
      undefined,
      new Date("2027-03-31T18:30:00.000Z")
    );
    expect(before).toEqual({ ok: true, months: FY_2026_27 });
    expect(after).toMatchObject({
      ok: true,
      months: expect.arrayContaining(["2027-04", "2028-03"]),
    });
  });

  it("refuses a range that ends before it starts", () => {
    expect(resolveMonthRange({ from: "2026-11", to: "2026-10" }, NOW)).toEqual(
      { ok: false, error: "range_reversed" }
    );
  });

  it("covers two financial years at most", () => {
    const twoYears = resolveMonthRange({ from: "2026-04", to: "2028-03" }, NOW);
    expect(twoYears.ok && twoYears.months.length).toBe(24);
    expect(resolveMonthRange({ from: "2026-04", to: "2028-04" }, NOW)).toEqual(
      { ok: false, error: "range_too_long" }
    );
  });
});
