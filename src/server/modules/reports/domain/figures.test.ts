import { describe, expect, it } from "vitest";

import { compareWithPrevious, percentOf } from "./figures";

describe("percentOf", () => {
  it.each([
    [1, 3, 33.3],
    [2, 3, 66.7],
    [1, 8, 12.5],
    // Half a tenth rounds up, with no binary-fraction drift.
    [1, 2000, 0.1],
    [1, 2001, 0],
    [201, 2000, 10.1],
    [3, 3, 100],
    [0, 7, 0],
    // A share can pass 100% (repeat visits, say).
    [5, 4, 125],
  ])("%i of %i is %d%", (part, whole, expected) => {
    expect(percentOf(part, whole)).toBe(expected);
  });

  it("is null when there is nothing to take a share of", () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(4, 0)).toBeNull();
  });

  it("refuses negative or fractional counts", () => {
    expect(() => percentOf(-1, 3)).toThrow(RangeError);
    expect(() => percentOf(1, -3)).toThrow(RangeError);
    expect(() => percentOf(1.5, 3)).toThrow(RangeError);
  });
});

describe("compareWithPrevious", () => {
  it("gives the change and the change as a percentage", () => {
    expect(compareWithPrevious(120, 100)).toEqual({
      current: 120,
      previous: 100,
      delta: 20,
      percent: 20,
    });
  });

  it("rounds a fall half away from zero, like a rise", () => {
    expect(compareWithPrevious(1999, 2000)).toMatchObject({
      delta: -1,
      percent: -0.1,
    });
    expect(compareWithPrevious(2001, 2000)).toMatchObject({
      delta: 1,
      percent: 0.1,
    });
    expect(compareWithPrevious(2, 3)).toMatchObject({
      delta: -1,
      percent: -33.3,
    });
  });

  it("has no percentage when the previous period had none", () => {
    expect(compareWithPrevious(5, 0)).toEqual({
      current: 5,
      previous: 0,
      delta: 5,
      percent: null,
    });
  });

  it("shows no change as zero", () => {
    expect(compareWithPrevious(7, 7)).toMatchObject({ delta: 0, percent: 0 });
    expect(compareWithPrevious(0, 0)).toMatchObject({
      delta: 0,
      percent: null,
    });
  });
});
