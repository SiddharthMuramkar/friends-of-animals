import { describe, expect, it } from "vitest";

import {
  DISPATCH_DAYS,
  DISPATCH_REMINDER_LEAD_HOURS,
  dispatchDeadline,
  dispatchReminderAt,
} from "./schedule";

const HOUR = 60 * 60 * 1000;

describe("setting bounds", () => {
  it("defaults to a 14-day window and a reminder 72 hours before it closes", () => {
    expect(DISPATCH_DAYS).toEqual({ default: 14, min: 3, max: 60 });
    expect(DISPATCH_REMINDER_LEAD_HOURS).toEqual({
      default: 72,
      min: 1,
      max: 336,
    });
  });
});

describe("dispatchDeadline", () => {
  it("closes at 23:59:59 IST on the day that many days after the request", () => {
    // 10:00 IST on 15 January → end of 29 January IST.
    expect(
      dispatchDeadline(new Date("2027-01-15T04:30:00.000Z"), 14).toISOString()
    ).toBe("2027-01-29T18:29:59.000Z");
  });

  it("counts from the IST calendar day, not the UTC one", () => {
    // 00:15 IST on 16 January is still 15 January in UTC.
    expect(
      dispatchDeadline(new Date("2027-01-15T18:45:00.000Z"), 14).toISOString()
    ).toBe("2027-01-30T18:29:59.000Z");
    // 23:59 IST on 15 January.
    expect(
      dispatchDeadline(new Date("2027-01-15T18:29:00.000Z"), 14).toISOString()
    ).toBe("2027-01-29T18:29:59.000Z");
  });

  it("crosses month and year ends", () => {
    expect(
      dispatchDeadline(new Date("2026-12-25T06:00:00.000Z"), 10).toISOString()
    ).toBe("2027-01-04T18:29:59.000Z");
    expect(
      dispatchDeadline(new Date("2028-02-20T06:00:00.000Z"), 9).toISOString()
    ).toBe("2028-02-29T18:29:59.000Z");
  });

  it("accepts the bounds of the setting", () => {
    const at = new Date("2027-01-15T04:30:00.000Z");
    expect(dispatchDeadline(at, 3).toISOString()).toBe(
      "2027-01-18T18:29:59.000Z"
    );
    expect(dispatchDeadline(at, 60).toISOString()).toBe(
      "2027-03-16T18:29:59.000Z"
    );
  });

  it.each([0, 2, 61, 14.5, Number.NaN])(
    "throws on %s days, which the settings registry never produces",
    (days) => {
      expect(() =>
        dispatchDeadline(new Date("2027-01-15T04:30:00.000Z"), days)
      ).toThrow(RangeError);
    }
  );
});

describe("dispatchReminderAt", () => {
  const requestedAt = new Date("2027-01-15T04:30:00.000Z");
  const deadline = dispatchDeadline(requestedAt, 14);

  it("fires the lead time before the deadline", () => {
    expect(
      dispatchReminderAt({ requestedAt, deadline, leadHours: 72 })
    ).toEqual(new Date(deadline.getTime() - 72 * HOUR));
  });

  it("is null when the window is shorter than the lead time", () => {
    const short = dispatchDeadline(requestedAt, 3);
    expect(
      dispatchReminderAt({ requestedAt, deadline: short, leadHours: 336 })
    ).toBeNull();
  });

  it("is null when it would fire at the moment of the request", () => {
    const exact = new Date(deadline.getTime() - 100 * HOUR);
    expect(
      dispatchReminderAt({ requestedAt: exact, deadline, leadHours: 100 })
    ).toBeNull();
    expect(
      dispatchReminderAt({
        requestedAt: new Date(exact.getTime() - 1),
        deadline,
        leadHours: 100,
      })
    ).toEqual(exact);
  });

  it.each([0, 337, 1.5])("throws on a lead of %s hours", (leadHours) => {
    expect(() =>
      dispatchReminderAt({ requestedAt, deadline, leadHours })
    ).toThrow(RangeError);
  });
});
