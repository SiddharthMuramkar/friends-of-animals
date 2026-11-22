import { describe, expect, it } from "vitest";

import {
  compareDates,
  completedYearsOn,
  formatIsoDate,
  indianDateAt,
  parseIsoDate,
} from "./calendar-date";

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe("parseIsoDate", () => {
  it("reads YYYY-MM-DD", () => {
    expect(parseIsoDate("2027-06-01")).toEqual(d(2027, 6, 1));
  });

  it.each(["2027-02-29", "2027-13-01", "2027-00-10", "2027-6-1", "01/06/2027"])(
    "refuses %j",
    (text) => {
      expect(parseIsoDate(text)).toBeNull();
    }
  );

  it("accepts 29 February in a leap year", () => {
    expect(parseIsoDate("2028-02-29")).toEqual(d(2028, 2, 29));
  });
});

describe("formatIsoDate", () => {
  it("pads to YYYY-MM-DD", () => {
    expect(formatIsoDate(d(2017, 6, 1))).toBe("2017-06-01");
  });
});

describe("compareDates", () => {
  it("orders by year, then month, then day", () => {
    expect(compareDates(d(2027, 1, 31), d(2027, 2, 1))).toBeLessThan(0);
    expect(compareDates(d(2027, 2, 1), d(2027, 2, 1))).toBe(0);
    expect(compareDates(d(2028, 1, 1), d(2027, 12, 31))).toBeGreaterThan(0);
  });
});

describe("indianDateAt", () => {
  it("turns the date at 18:30 UTC, IST midnight", () => {
    expect(indianDateAt(new Date("2027-05-31T18:29:59.999Z"))).toEqual(
      d(2027, 5, 31)
    );
    expect(indianDateAt(new Date("2027-05-31T18:30:00.000Z"))).toEqual(
      d(2027, 6, 1)
    );
  });
});

describe("completedYearsOn", () => {
  const cutoff = d(2027, 6, 1);

  it.each([
    ["the birthday falls on the day", d(2017, 6, 1), 10],
    ["the birthday is the next day", d(2017, 6, 2), 9],
    ["the birthday was the day before", d(2017, 5, 31), 10],
    ["born on the day itself", d(2027, 6, 1), 0],
  ])("counts completed years when %s", (_case, birth, years) => {
    expect(completedYearsOn(birth, cutoff)).toBe(years);
  });

  it("counts a 29 February birthday on 1 March in other years", () => {
    const leapling = d(2016, 2, 29);
    expect(completedYearsOn(leapling, d(2027, 2, 28))).toBe(10);
    expect(completedYearsOn(leapling, d(2027, 3, 1))).toBe(11);
    expect(completedYearsOn(leapling, d(2028, 2, 29))).toBe(12);
  });

  it("is negative for someone born after the date", () => {
    expect(completedYearsOn(d(2028, 1, 1), cutoff)).toBeLessThan(0);
  });
});
