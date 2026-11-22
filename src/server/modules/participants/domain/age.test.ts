import { describe, expect, it } from "vitest";

import { ageAt, isAdultAt, parseDateOfBirth } from "./age";

const date = (year: number, month: number, day: number) => ({
  year,
  month,
  day,
});

describe("ageAt", () => {
  it("counts completed years on the Indian calendar date of the instant", () => {
    // 10:00 IST on 15 January 2027.
    const at = new Date("2027-01-15T04:30:00.000Z");
    expect(ageAt(date(2000, 1, 15), at)).toBe(27);
    expect(ageAt(date(2000, 1, 16), at)).toBe(26);
    expect(ageAt(date(2000, 12, 31), at)).toBe(26);
  });

  it("turns a year older at midnight in India, not at midnight UTC", () => {
    const dob = date(2009, 3, 10);
    // 23:59 IST on 9 March 2027 is still the day before the birthday.
    expect(ageAt(dob, new Date("2027-03-09T18:29:59.999Z"))).toBe(17);
    // 00:00 IST on 10 March 2027 is the birthday, though UTC says 9 March.
    expect(ageAt(dob, new Date("2027-03-09T18:30:00.000Z"))).toBe(18);
  });

  it("makes a 29 February birthday count from 1 March in other years", () => {
    const leapling = date(2008, 2, 29);
    expect(ageAt(leapling, new Date("2027-02-28T06:30:00.000Z"))).toBe(18);
    expect(ageAt(leapling, new Date("2026-02-28T06:30:00.000Z"))).toBe(17);
    expect(ageAt(leapling, new Date("2026-03-01T06:30:00.000Z"))).toBe(18);
    expect(ageAt(leapling, new Date("2028-02-29T06:30:00.000Z"))).toBe(20);
  });
});

describe("isAdultAt", () => {
  const at = new Date("2027-01-15T04:30:00.000Z");

  it("is true from the 18th birthday, in India's calendar", () => {
    expect(isAdultAt(date(2009, 1, 15), at)).toBe(true);
    expect(isAdultAt(date(1960, 6, 1), at)).toBe(true);
  });

  it("is false the day before the 18th birthday", () => {
    expect(isAdultAt(date(2009, 1, 16), at)).toBe(false);
    expect(isAdultAt(date(2015, 5, 5), at)).toBe(false);
  });

  it("treats someone born on 29 February as 17 until 1 March", () => {
    const leapling = date(2008, 2, 29);
    expect(isAdultAt(leapling, new Date("2026-02-28T12:00:00.000Z"))).toBe(
      false
    );
    expect(isAdultAt(leapling, new Date("2026-02-28T18:30:00.000Z"))).toBe(
      true
    );
  });
});

describe("parseDateOfBirth", () => {
  const at = new Date("2027-01-15T04:30:00.000Z");

  it("reads a YYYY-MM-DD calendar date", () => {
    expect(parseDateOfBirth("1998-07-04", at)).toEqual(date(1998, 7, 4));
    expect(parseDateOfBirth("2004-02-29", at)).toEqual(date(2004, 2, 29));
  });

  it("refuses dates that do not exist", () => {
    for (const text of ["2003-02-29", "1999-04-31", "1999-13-01", "1999-00-10"])
      expect(parseDateOfBirth(text, at)).toBeNull();
  });

  it("refuses other spellings rather than guessing day and month", () => {
    for (const text of [
      "04/07/1998",
      "1998-7-4",
      "19980704",
      " 1998-07-04",
      "",
    ])
      expect(parseDateOfBirth(text, at)).toBeNull();
  });

  it("refuses a date after today in India", () => {
    // 23:59 IST on 15 January 2027 is still the 15th; 00:00 IST is the 16th.
    expect(parseDateOfBirth("2027-01-15", at)).toEqual(date(2027, 1, 15));
    expect(parseDateOfBirth("2027-01-16", at)).toBeNull();
    expect(
      parseDateOfBirth("2027-01-16", new Date("2027-01-15T18:30:00.000Z"))
    ).toEqual(date(2027, 1, 16));
  });

  it("refuses dates before 1900", () => {
    expect(parseDateOfBirth("1900-01-01", at)).toEqual(date(1900, 1, 1));
    expect(parseDateOfBirth("1899-12-31", at)).toBeNull();
  });
});
