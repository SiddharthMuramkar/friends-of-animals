import { describe, expect, it } from "vitest";

import { instantToIstLocal, istLocalToInstant } from "./ist";

describe("istLocalToInstant()", () => {
  it("reads a datetime-local value as IST and returns the UTC instant", () => {
    const result = istLocalToInstant("2027-01-15T10:00");
    expect(result.ok && result.at.toISOString()).toBe(
      "2027-01-15T04:30:00.000Z"
    );
  });

  it("accepts seconds, which some browsers send", () => {
    const result = istLocalToInstant("2027-01-15T23:59:30");
    expect(result.ok && result.at.toISOString()).toBe(
      "2027-01-15T18:29:30.000Z"
    );
  });

  it("crosses midnight back into the previous UTC day", () => {
    const result = istLocalToInstant("2027-03-01T02:00");
    expect(result.ok && result.at.toISOString()).toBe(
      "2027-02-28T20:30:00.000Z"
    );
  });

  it("refuses dates and times that don't exist", () => {
    for (const local of [
      "2027-02-29T10:00",
      "2027-02-30T10:00",
      "2027-13-01T10:00",
      "2027-01-15T24:00",
      "2027-01-15T10:60",
    ]) {
      expect(istLocalToInstant(local)).toEqual({
        ok: false,
        error: "invalid_date",
      });
    }
  });

  it("accepts 29 February in a leap year", () => {
    expect(istLocalToInstant("2028-02-29T09:00").ok).toBe(true);
  });

  it("refuses anything that isn't a datetime-local value", () => {
    for (const local of [
      "",
      "2027-01-15",
      "2027-01-15 10:00",
      "2027-01-15T10:00Z",
      "2027-01-15T10:00+05:30",
      "15/01/2027 10:00",
    ]) {
      expect(istLocalToInstant(local)).toEqual({
        ok: false,
        error: "invalid_date",
      });
    }
  });
});

describe("instantToIstLocal()", () => {
  it("shows a stored instant back as the IST datetime-local value", () => {
    expect(instantToIstLocal(new Date("2027-01-15T04:30:00.000Z"))).toBe(
      "2027-01-15T10:00"
    );
  });

  it("round-trips with istLocalToInstant", () => {
    for (const local of ["2027-01-15T10:00", "2027-02-28T23:45"]) {
      const result = istLocalToInstant(local);
      expect(result.ok && instantToIstLocal(result.at)).toBe(local);
    }
  });

  it("throws on an invalid Date rather than showing garbage", () => {
    expect(() => instantToIstLocal(new Date(Number.NaN))).toThrow(RangeError);
  });
});
