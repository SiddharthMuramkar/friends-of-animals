import { describe, expect, it } from "vitest";

import {
  ADOPTION_AGE_BANDS,
  ageBand,
  ageInMonths,
  ageParts,
  birthMonthRange,
  estimateBirthMonth,
  fromDateColumn,
  istMonth,
  toDateColumn,
  type YearMonth,
} from "./age";

// 10:00 IST on 15 January 2027, the harness's default instant.
const NOW = new Date("2027-01-15T04:30:00.000Z");

describe("istMonth", () => {
  it("reads the month in India, not in UTC", () => {
    // 31 Dec 2026 20:00 UTC is already 1 Jan 2027 in India.
    expect(istMonth(new Date("2026-12-31T20:00:00.000Z"))).toBe("2027-01");
    expect(istMonth(new Date("2026-12-31T18:00:00.000Z"))).toBe("2026-12");
  });
});

describe("estimateBirthMonth", () => {
  it("counts back the estimated age from this month", () => {
    expect(estimateBirthMonth({ years: 0, months: 0 }, NOW)).toBe("2027-01");
    expect(estimateBirthMonth({ years: 0, months: 3 }, NOW)).toBe("2026-10");
    expect(estimateBirthMonth({ years: 2, months: 1 }, NOW)).toBe("2024-12");
    expect(estimateBirthMonth({ years: 10, months: 0 }, NOW)).toBe("2017-01");
  });

  it.each([
    { years: -1, months: 0 },
    { years: 0, months: 12 },
    { years: 0, months: -1 },
    { years: 1.5, months: 0 },
    { years: 61, months: 0 },
  ])("refuses an age of %o", (age) => {
    expect(() => estimateBirthMonth(age, NOW)).toThrow(RangeError);
  });
});

describe("ageInMonths and ageParts", () => {
  it("is the whole months between the birth month and this month", () => {
    expect(ageInMonths("2027-01", NOW)).toBe(0);
    expect(ageInMonths("2024-12", NOW)).toBe(25);
    expect(ageParts("2024-12", NOW)).toEqual({ years: 2, months: 1 });
  });

  it("grows as the clock moves, because only the birth month is stored", () => {
    const born = estimateBirthMonth({ years: 0, months: 5 }, NOW);
    expect(ageBand(born, NOW)).toBe("baby");
    expect(ageBand(born, new Date("2027-02-01T00:00:00.000Z"))).toBe("young");
  });

  it("treats a birth month after this month as newborn", () => {
    expect(ageInMonths("2027-03", NOW)).toBe(0);
  });
});

describe("age bands", () => {
  it("has four bands, youngest first", () => {
    expect(ADOPTION_AGE_BANDS).toEqual(["baby", "young", "adult", "senior"]);
  });

  it.each([
    [0, "baby"],
    [5, "baby"],
    [6, "young"],
    [23, "young"],
    [24, "adult"],
    [95, "adult"],
    [96, "senior"],
    [400, "senior"],
  ] as const)("puts %i months in %s", (months, band) => {
    const born = estimateBirthMonth(
      { years: Math.floor(months / 12), months: months % 12 },
      NOW
    );
    expect(ageBand(born, NOW)).toBe(band);
  });

  it("gives the birth-month range a query filters on for each band", () => {
    expect(birthMonthRange("baby", NOW)).toEqual({
      earliest: "2026-08",
      latest: "2027-01",
    });
    expect(birthMonthRange("young", NOW)).toEqual({
      earliest: "2025-02",
      latest: "2026-07",
    });
    expect(birthMonthRange("adult", NOW)).toEqual({
      earliest: "2019-02",
      latest: "2025-01",
    });
    expect(birthMonthRange("senior", NOW)).toEqual({
      earliest: null,
      latest: "2019-01",
    });
  });

  it("agrees with ageBand for every month across 60 years", () => {
    for (let months = 0; months <= 720; months += 1) {
      const born = estimateBirthMonth(
        { years: Math.floor(months / 12), months: months % 12 },
        NOW
      );
      for (const band of ADOPTION_AGE_BANDS) {
        const { earliest, latest } = birthMonthRange(band, NOW);
        const inRange =
          (earliest === null || born >= earliest) && born <= latest;
        expect(inRange, `${born} in ${band}`).toBe(ageBand(born, NOW) === band);
      }
    }
  });
});

describe("the date column", () => {
  it("stores the first of the month and reads it back", () => {
    expect(toDateColumn("2024-12")).toBe("2024-12-01");
    expect(fromDateColumn("2024-12-01")).toBe("2024-12");
  });

  it.each(["2024-13", "2024-1", "24-01", "2024-00", "x"])(
    "refuses %s as a month",
    (month) => {
      expect(() => toDateColumn(month as YearMonth)).toThrow(RangeError);
    }
  );

  it("refuses a stored date that is not the first of a month", () => {
    expect(() => fromDateColumn("2024-12-15")).toThrow(RangeError);
  });
});
