import { describe, expect, it } from "vitest";

import { nextPurgeStep, PURGE_LIMITS, purgeDeadlines } from "./schedule";

const T = new Date("2027-01-15T04:30:00.000Z");
const at = (seconds: number) => new Date(T.getTime() + seconds * 1000);
const MIN = 60;
const HOUR = 60 * MIN;

describe("purgeDeadlines", () => {
  it("counts the limit from the withdrawal, with a 24-hour hard stop", () => {
    expect(purgeDeadlines(T, 15)).toEqual({
      deadlineAt: at(15 * MIN),
      hardDeadlineAt: at(24 * HOUR),
    });
    expect(purgeDeadlines(T, 1440)).toEqual({
      deadlineAt: at(24 * HOUR),
      hardDeadlineAt: at(24 * HOUR),
    });
  });

  it("defaults to 15 minutes and accepts 1 to 1440", () => {
    expect(PURGE_LIMITS).toMatchObject({
      defaultMinutes: 15,
      minMinutes: 1,
      maxMinutes: 1440,
    });
    expect(purgeDeadlines(T, 1).deadlineAt).toEqual(at(MIN));
  });

  it.each([0, -5, 1441, 2.5, Number.NaN])("refuses %s minutes", (minutes) => {
    expect(() => purgeDeadlines(T, minutes)).toThrow(RangeError);
  });
});

describe("nextPurgeStep before the deadline", () => {
  const progress = (failedAttempts: number) => ({
    ...purgeDeadlines(T, 15),
    failedAttempts,
    overdueAlerted: false,
  });

  it("backs off 15 s, 30 s, 60 s, then every 2 minutes", () => {
    expect(nextPurgeStep(progress(1), at(1))).toEqual({
      kind: "retry",
      at: at(16),
      alert: "none",
    });
    expect(nextPurgeStep(progress(2), at(16))).toMatchObject({ at: at(46) });
    expect(nextPurgeStep(progress(3), at(46))).toMatchObject({ at: at(106) });
    expect(nextPurgeStep(progress(4), at(106))).toMatchObject({ at: at(226) });
    expect(nextPurgeStep(progress(12), at(300))).toMatchObject({ at: at(420) });
  });

  it("never schedules past the deadline: the last try is at it", () => {
    expect(nextPurgeStep(progress(9), at(14 * MIN))).toEqual({
      kind: "retry",
      at: at(15 * MIN),
      alert: "none",
    });
  });
});

describe("nextPurgeStep after the deadline", () => {
  it("raises the overdue alert once and keeps trying every 10 minutes", () => {
    const deadlines = purgeDeadlines(T, 15);
    expect(
      nextPurgeStep(
        { ...deadlines, failedAttempts: 10, overdueAlerted: false },
        at(15 * MIN)
      )
    ).toEqual({ kind: "retry", at: at(25 * MIN), alert: "overdue" });
    expect(
      nextPurgeStep(
        { ...deadlines, failedAttempts: 11, overdueAlerted: true },
        at(25 * MIN)
      )
    ).toEqual({ kind: "retry", at: at(35 * MIN), alert: "none" });
  });

  it("makes one last try at the hard stop, then gives up with an alert", () => {
    const deadlines = purgeDeadlines(T, 15);
    const late = { ...deadlines, failedAttempts: 150, overdueAlerted: true };
    expect(nextPurgeStep(late, at(24 * HOUR - 5 * MIN))).toEqual({
      kind: "retry",
      at: at(24 * HOUR),
      alert: "none",
    });
    expect(nextPurgeStep(late, at(24 * HOUR))).toEqual({
      kind: "give_up",
      alert: "failed",
    });
    expect(nextPurgeStep(late, at(30 * HOUR))).toEqual({
      kind: "give_up",
      alert: "failed",
    });
  });

  it("still raises the overdue alert if the first failure comes late", () => {
    const deadlines = purgeDeadlines(T, 15);
    expect(
      nextPurgeStep(
        { ...deadlines, failedAttempts: 1, overdueAlerted: false },
        at(2 * HOUR)
      )
    ).toEqual({ kind: "retry", at: at(2 * HOUR + 10 * MIN), alert: "overdue" });
  });
});

describe("nextPurgeStep input", () => {
  it("is only asked after a failed attempt", () => {
    expect(() =>
      nextPurgeStep(
        { ...purgeDeadlines(T, 15), failedAttempts: 0, overdueAlerted: false },
        T
      )
    ).toThrow(RangeError);
  });
});
