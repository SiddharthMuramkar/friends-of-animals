import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_OFFSETS_HOURS,
  planReminderTimes,
  reminderOffsetsSchema,
} from "./offsets";

describe("reminderOffsetsSchema", () => {
  it("defaults to 72 and 24 hours before the deadline", () => {
    expect(DEFAULT_REMINDER_OFFSETS_HOURS).toEqual([72, 24]);
    expect(reminderOffsetsSchema.parse(DEFAULT_REMINDER_OFFSETS_HOURS)).toEqual(
      [72, 24]
    );
  });

  it("sorts offsets furthest first", () => {
    expect(reminderOffsetsSchema.parse([24, 168, 72])).toEqual([168, 72, 24]);
  });

  it("allows no reminders at all", () => {
    expect(reminderOffsetsSchema.parse([])).toEqual([]);
  });

  it.each([
    ["a zero offset", [0]],
    ["a fractional hour", [1.5]],
    ["more than 30 days", [721]],
    ["the same offset twice", [24, 24]],
    ["more than five offsets", [1, 2, 3, 4, 5, 6]],
    ["a value that is not a list", 24],
  ])("refuses %s", (_label, value) => {
    expect(reminderOffsetsSchema.safeParse(value).success).toBe(false);
  });
});

describe("planReminderTimes", () => {
  const deadlineAt = new Date("2027-02-13T18:29:00.000Z"); // 23:59 IST

  it("plans one reminder per offset before the deadline, soonest first", () => {
    const now = new Date("2027-02-01T00:00:00.000Z");

    expect(
      planReminderTimes({ deadlineAt, offsetsHours: [72, 24], now })
    ).toEqual([
      { offsetHours: 72, fireAt: new Date("2027-02-10T18:29:00.000Z") },
      { offsetHours: 24, fireAt: new Date("2027-02-12T18:29:00.000Z") },
    ]);
  });

  it("skips an offset whose time has already gone, without catching up", () => {
    const now = new Date("2027-02-11T00:00:00.000Z");

    expect(
      planReminderTimes({ deadlineAt, offsetsHours: [72, 24], now })
    ).toEqual([
      { offsetHours: 24, fireAt: new Date("2027-02-12T18:29:00.000Z") },
    ]);
  });

  it("keeps a reminder that is due right now", () => {
    const now = new Date("2027-02-12T18:29:00.000Z");

    expect(
      planReminderTimes({ deadlineAt, offsetsHours: [24], now }).map(
        (reminder) => reminder.offsetHours
      )
    ).toEqual([24]);
  });

  it("plans nothing once the deadline has passed", () => {
    const now = new Date("2027-02-14T00:00:00.000Z");

    expect(
      planReminderTimes({ deadlineAt, offsetsHours: [72, 24], now })
    ).toEqual([]);
  });

  it("plans nothing without a deadline", () => {
    expect(
      planReminderTimes({
        deadlineAt: null,
        offsetsHours: [72, 24],
        now: new Date("2027-02-01T00:00:00.000Z"),
      })
    ).toEqual([]);
  });
});
