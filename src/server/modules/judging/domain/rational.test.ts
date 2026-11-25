import { describe, expect, it } from "vitest";

import {
  addRationals,
  compareRationals,
  divideRational,
  formatRational,
  multiplyRational,
  rational,
} from "./rational";

describe("rational()", () => {
  it("keeps fractions in lowest terms with a positive denominator", () => {
    expect(rational(6, 8)).toEqual({ num: 3n, den: 4n });
    expect(rational(3, -6)).toEqual({ num: -1n, den: 2n });
    expect(rational(0, 5)).toEqual({ num: 0n, den: 1n });
  });

  it("refuses a zero denominator and non-integers", () => {
    expect(() => rational(1, 0)).toThrow(RangeError);
    expect(() => rational(1.5, 2)).toThrow(RangeError);
  });
});

describe("arithmetic", () => {
  it("adds, multiplies and divides exactly", () => {
    const third = rational(1, 3);
    expect(addRationals(third, third, third)).toEqual(rational(1, 1));
    expect(addRationals()).toEqual(rational(0, 1));
    expect(multiplyRational(rational(2, 3), 9)).toEqual(rational(6, 1));
    expect(divideRational(rational(5, 1), 4)).toEqual(rational(5, 4));
    expect(() => divideRational(third, 0)).toThrow(RangeError);
  });

  it("orders values exactly, beyond what 2 decimals show", () => {
    const a = rational(1000001, 1000000);
    const b = rational(1, 1);
    expect(compareRationals(a, b)).toBe(1);
    expect(compareRationals(b, a)).toBe(-1);
    expect(compareRationals(rational(2, 4), rational(1, 2))).toBe(0);
  });
});

describe("formatRational()", () => {
  it("shows two decimals, rounding halves up", () => {
    expect(formatRational(rational(2485, 30))).toBe("82.83");
    expect(formatRational(rational(70, 1))).toBe("70.00");
    expect(formatRational(rational(1, 8))).toBe("0.13");
    expect(formatRational(rational(1, 3), 0)).toBe("0");
    expect(formatRational(rational(-1, 8))).toBe("-0.13");
  });
});
