import { describe, expect, it } from "vitest";

import {
  financialYearOfMonth,
  isPeriodMonth,
  monthsOfFinancialYear,
  parseFinancialYearLabel,
  pickFinancialYear,
  publishedFinancialYears,
} from "./financial-year";

describe("isPeriodMonth", () => {
  it.each(["2026-04", "2026-11", "2027-01", "2027-12", "1999-09"])(
    "accepts %s",
    (month) => {
      expect(isPeriodMonth(month)).toBe(true);
    }
  );

  it.each([
    "2026-00",
    "2026-13",
    "2026-1",
    "26-11",
    "2026/11",
    "2026-11-01",
    "",
  ])("refuses %j", (month) => {
    expect(isPeriodMonth(month)).toBe(false);
  });
});

describe("financialYearOfMonth", () => {
  it.each([
    ["2026-04", 2026, "2026-27"],
    ["2026-11", 2026, "2026-27"],
    ["2027-01", 2026, "2026-27"],
    ["2027-03", 2026, "2026-27"],
    ["2027-04", 2027, "2027-28"],
    ["2026-03", 2025, "2025-26"],
    // The century turn keeps two digits after the hyphen.
    ["2099-12", 2099, "2099-00"],
  ])("%s is in FY %i (%s)", (month, startYear, label) => {
    expect(financialYearOfMonth(month)).toEqual({ startYear, label });
  });

  it("refuses something that is not a period month", () => {
    expect(() => financialYearOfMonth("2026-13")).toThrow(RangeError);
  });
});

describe("monthsOfFinancialYear", () => {
  it("lists April to March in order", () => {
    expect(
      monthsOfFinancialYear({ startYear: 2026, label: "2026-27" })
    ).toEqual([
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
    ]);
  });
});

describe("parseFinancialYearLabel", () => {
  it.each([
    ["2026-27", 2026],
    ["2027-28", 2027],
    ["2099-00", 2099],
  ])("reads %s", (label, startYear) => {
    expect(parseFinancialYearLabel(label)).toEqual({ startYear, label });
  });

  it.each(["2026-28", "2026", "2627", "2026-2027", "abcd-ef", " 2026-27", ""])(
    "refuses %j",
    (label) => {
      expect(parseFinancialYearLabel(label)).toBeNull();
    }
  );
});

describe("publishedFinancialYears", () => {
  it("lists each year with a locked month once, newest first", () => {
    expect(
      publishedFinancialYears(["2026-10", "2025-06", "2027-02", "2026-04"])
    ).toEqual([
      { startYear: 2026, label: "2026-27" },
      { startYear: 2025, label: "2025-26" },
    ]);
  });

  it("is empty before the first month is locked", () => {
    expect(publishedFinancialYears([])).toEqual([]);
  });
});

describe("pickFinancialYear", () => {
  const locked = ["2025-07", "2026-10", "2026-11", "2027-04"];

  it("defaults to the year of the latest locked month", () => {
    expect(pickFinancialYear(undefined, locked)).toEqual({
      startYear: 2027,
      label: "2027-28",
    });
  });

  it("keeps a requested year that has a locked month", () => {
    expect(pickFinancialYear("2025-26", locked)).toEqual({
      startYear: 2025,
      label: "2025-26",
    });
  });

  it.each(["2024-25", "nonsense", "2026-28"])(
    "falls back to the default for %j",
    (requested) => {
      expect(pickFinancialYear(requested, locked)?.label).toBe("2027-28");
    }
  );

  it("is null when nothing is published", () => {
    expect(pickFinancialYear("2026-27", [])).toBeNull();
  });
});
