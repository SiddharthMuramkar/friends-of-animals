import { describe, expect, it } from "vitest";

import { isUnder18On } from "./age";

describe("isUnder18On", () => {
  // 2027-01-15T04:30:00Z is 10:00 IST on 15 January 2027.
  const at = new Date("2027-01-15T04:30:00.000Z");

  it("counts someone who turns 18 later this year as a minor", () => {
    expect(isUnder18On("2009-06-01", at)).toBe(true);
  });

  it("counts someone who turned 18 earlier this year as an adult", () => {
    expect(isUnder18On("2009-01-01", at)).toBe(false);
  });

  it("makes someone an adult on their 18th birthday", () => {
    expect(isUnder18On("2009-01-15", at)).toBe(false);
  });

  it("keeps someone a minor on the day before their 18th birthday", () => {
    expect(isUnder18On("2009-01-16", at)).toBe(true);
  });

  it("reads the birthday on the India calendar, not the UTC one", () => {
    // 20:00 UTC on 14 January is 01:30 IST on 15 January: already the birthday.
    expect(isUnder18On("2009-01-15", new Date("2027-01-14T20:00:00Z"))).toBe(
      false
    );
    // 18:00 UTC on 14 January is 23:30 IST on 14 January: not yet.
    expect(isUnder18On("2009-01-15", new Date("2027-01-14T18:00:00Z"))).toBe(
      true
    );
  });

  it("keeps someone born on 29 February a minor until 1 March", () => {
    expect(isUnder18On("2008-02-29", new Date("2026-02-28T06:00:00Z"))).toBe(
      true
    );
    expect(isUnder18On("2008-02-29", new Date("2026-03-01T06:00:00Z"))).toBe(
      false
    );
  });

  it("treats an unknown date of birth as a minor", () => {
    expect(isUnder18On(null, at)).toBe(true);
  });

  it("refuses a date that is not a real calendar date", () => {
    expect(() => isUnder18On("2009-02-30", at)).toThrow(RangeError);
    expect(() => isUnder18On("15/01/2009", at)).toThrow(RangeError);
  });
});
