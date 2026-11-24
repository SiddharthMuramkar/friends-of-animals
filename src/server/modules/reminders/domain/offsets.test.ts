import { describe, expect, it } from "vitest";

import { MAX_REMINDER_OFFSET_HOURS, reminderOffsets } from "./offsets";

describe("reminderOffsets", () => {
  it("lists each setting's hours, furthest from the deadline first", () => {
    expect(reminderOffsets([24, 72])).toEqual([72, 24]);
  });

  it("drops a setting at 0, which turns that reminder off", () => {
    expect(reminderOffsets([72, 0])).toEqual([72]);
    expect(reminderOffsets([0, 0])).toEqual([]);
  });

  it("sends one reminder when two settings name the same hour", () => {
    expect(reminderOffsets([24, 24])).toEqual([24]);
  });

  it("ignores a value no setting may hold", () => {
    expect(
      reminderOffsets([-1, 1.5, MAX_REMINDER_OFFSET_HOURS + 1, 48])
    ).toEqual([48]);
  });

  it("allows reminders up to 30 days before a deadline", () => {
    expect(MAX_REMINDER_OFFSET_HOURS).toBe(720);
    expect(reminderOffsets([720])).toEqual([720]);
  });
});
