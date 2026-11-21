import { describe, expect, it } from "vitest";

import { fixedWindow, latestRetry } from "./rate-window";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("fixed rate-limit windows", () => {
  it("puts an instant in the hour that contains it", () => {
    expect(fixedWindow(new Date("2027-01-15T04:30:00.000Z"), HOUR)).toEqual({
      start: new Date("2027-01-15T04:00:00.000Z"),
      end: new Date("2027-01-15T05:00:00.000Z"),
    });
  });

  it("starts a new window exactly on the boundary", () => {
    expect(
      fixedWindow(new Date("2027-01-15T05:00:00.000Z"), HOUR).start
    ).toEqual(new Date("2027-01-15T05:00:00.000Z"));
    expect(
      fixedWindow(new Date("2027-01-15T04:59:59.999Z"), HOUR).start
    ).toEqual(new Date("2027-01-15T04:00:00.000Z"));
  });

  it("aligns day windows to midnight UTC (05:30 in India)", () => {
    expect(fixedWindow(new Date("2027-01-15T23:59:59.999Z"), DAY)).toEqual({
      start: new Date("2027-01-15T00:00:00.000Z"),
      end: new Date("2027-01-16T00:00:00.000Z"),
    });
  });

  it("refuses a window that isn't a positive whole number of ms", () => {
    const now = new Date("2027-01-15T04:30:00.000Z");
    expect(() => fixedWindow(now, 0)).toThrow(RangeError);
    expect(() => fixedWindow(now, -HOUR)).toThrow(RangeError);
    expect(() => fixedWindow(now, 1.5)).toThrow(RangeError);
  });
});

describe("when a refused sender may try again", () => {
  const now = new Date("2027-01-15T04:30:00.000Z");

  it("waits for the last refusing window to end", () => {
    expect(
      latestRetry(now, [fixedWindow(now, HOUR), fixedWindow(now, DAY)])
    ).toEqual({
      retryAfter: new Date("2027-01-16T00:00:00.000Z"),
      retryAfterSeconds: 70_200,
    });
  });

  it("rounds a part second up, so a retry never comes too early", () => {
    const later = new Date("2027-01-15T04:59:59.500Z");
    expect(latestRetry(later, [fixedWindow(later, HOUR)])).toEqual({
      retryAfter: new Date("2027-01-15T05:00:00.000Z"),
      retryAfterSeconds: 1,
    });
  });

  it("needs at least one window", () => {
    expect(() => latestRetry(now, [])).toThrow(RangeError);
  });
});
