import { describe, expect, it } from "vitest";

import {
  checkReminderAtRunTime,
  diffReminderSchedule,
  type ScheduledReminder,
} from "./schedule";

const deadlineAt = new Date("2027-02-13T18:29:00.000Z");
const movedDeadlineAt = new Date("2027-02-15T18:29:00.000Z");
const hours = (n: number) => n * 60 * 60 * 1000;

const scheduled = (
  id: string,
  offsetHours: number,
  deadline: Date = deadlineAt
): ScheduledReminder => ({
  id,
  offsetHours,
  deadlineAt: deadline,
  fireAt: new Date(deadline.getTime() - hours(offsetHours)),
  status: "scheduled",
});

const planned = (offsetHours: number, deadline: Date = deadlineAt) => ({
  offsetHours,
  fireAt: new Date(deadline.getTime() - hours(offsetHours)),
});

describe("diffReminderSchedule", () => {
  it("creates every planned reminder when none is scheduled", () => {
    const diff = diffReminderSchedule({
      existing: [],
      deadlineAt,
      planned: [planned(72), planned(24)],
    });

    expect(diff).toEqual({
      keep: [],
      create: [
        { offsetHours: 72, deadlineAt, fireAt: planned(72).fireAt },
        { offsetHours: 24, deadlineAt, fireAt: planned(24).fireAt },
      ],
      supersede: [],
    });
  });

  it("changes nothing when scheduling runs again with the same deadline", () => {
    const existing = [scheduled("r72", 72), scheduled("r24", 24)];

    const diff = diffReminderSchedule({
      existing,
      deadlineAt,
      planned: [planned(72), planned(24)],
    });

    expect(diff).toEqual({ keep: ["r72", "r24"], create: [], supersede: [] });
  });

  it("supersedes the old reminders and plans new ones when the deadline moves", () => {
    const diff = diffReminderSchedule({
      existing: [scheduled("r72", 72), scheduled("r24", 24)],
      deadlineAt: movedDeadlineAt,
      planned: [planned(72, movedDeadlineAt), planned(24, movedDeadlineAt)],
    });

    expect(diff.keep).toEqual([]);
    expect(diff.supersede).toEqual(["r72", "r24"]);
    expect(diff.create.map((r) => [r.offsetHours, r.deadlineAt])).toEqual([
      [72, movedDeadlineAt],
      [24, movedDeadlineAt],
    ]);
  });

  it("follows a change of offsets in settings", () => {
    const diff = diffReminderSchedule({
      existing: [scheduled("r72", 72), scheduled("r24", 24)],
      deadlineAt,
      planned: [planned(48), planned(24)],
    });

    expect(diff).toEqual({
      keep: ["r24"],
      create: [{ offsetHours: 48, deadlineAt, fireAt: planned(48).fireAt }],
      supersede: ["r72"],
    });
  });

  it("supersedes everything when the deadline is removed", () => {
    const diff = diffReminderSchedule({
      existing: [scheduled("r72", 72)],
      deadlineAt: null,
      planned: [],
    });

    expect(diff).toEqual({ keep: [], create: [], supersede: ["r72"] });
  });

  it("ignores reminders that already fired or were cancelled", () => {
    const fired: ScheduledReminder = {
      ...scheduled("r72", 72),
      status: "fired",
    };

    const diff = diffReminderSchedule({
      existing: [fired],
      deadlineAt,
      planned: [planned(24)],
    });

    expect(diff).toEqual({
      keep: [],
      create: [{ offsetHours: 24, deadlineAt, fireAt: planned(24).fireAt }],
      supersede: [],
    });
  });

  it("does not plan again a reminder that already fired for this deadline", () => {
    const fired: ScheduledReminder = {
      ...scheduled("r72", 72),
      status: "fired",
    };

    const diff = diffReminderSchedule({
      existing: [fired],
      deadlineAt,
      planned: [planned(72), planned(24)],
    });

    expect(diff.create.map((r) => r.offsetHours)).toEqual([24]);
  });
});

describe("checkReminderAtRunTime", () => {
  const reminder = scheduled("r24", 24);
  const dueAt = reminder.fireAt;

  it("runs a scheduled reminder at its time while the deadline is unchanged", () => {
    expect(
      checkReminderAtRunTime({
        reminder,
        currentDeadlineAt: deadlineAt,
        now: dueAt,
      })
    ).toEqual({ run: true });
  });

  it("does nothing when the deadline moved after it was scheduled", () => {
    expect(
      checkReminderAtRunTime({
        reminder,
        currentDeadlineAt: movedDeadlineAt,
        now: dueAt,
      })
    ).toEqual({ run: false, reason: "deadline_changed" });
  });

  it("does nothing when the deadline was removed", () => {
    expect(
      checkReminderAtRunTime({ reminder, currentDeadlineAt: null, now: dueAt })
    ).toEqual({ run: false, reason: "deadline_removed" });
  });

  it("does nothing once superseded, fired or cancelled", () => {
    for (const status of ["superseded", "fired", "cancelled"] as const) {
      expect(
        checkReminderAtRunTime({
          reminder: { ...reminder, status },
          currentDeadlineAt: deadlineAt,
          now: dueAt,
        })
      ).toEqual({ run: false, reason: status });
    }
  });

  it("does nothing when the job runs early", () => {
    expect(
      checkReminderAtRunTime({
        reminder,
        currentDeadlineAt: deadlineAt,
        now: new Date(dueAt.getTime() - 1),
      })
    ).toEqual({ run: false, reason: "not_due" });
  });

  it("does nothing when the job runs after the deadline has passed", () => {
    expect(
      checkReminderAtRunTime({
        reminder,
        currentDeadlineAt: deadlineAt,
        now: deadlineAt,
      })
    ).toEqual({ run: false, reason: "deadline_passed" });
  });
});
