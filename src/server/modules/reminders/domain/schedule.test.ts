import { describe, expect, it } from "vitest";

import {
  checkReminderAtRunTime,
  diffReminderSchedule,
  type Deadline,
  type ScheduledReminder,
} from "./schedule";

const deadlineAt = new Date("2027-02-13T18:29:00.000Z"); // 23:59 IST
const movedDeadlineAt = new Date("2027-02-15T18:29:00.000Z");
const hours = (n: number) => n * 60 * 60 * 1000;
const open = (at: Date = deadlineAt): Deadline => ({ kind: "open", at });
const before = (n: number, deadline: Date = deadlineAt) =>
  new Date(deadline.getTime() - hours(n));

const row = (
  id: string,
  offsetHours: number,
  status: ScheduledReminder["status"] = "scheduled",
  deadline: Date = deadlineAt
): ScheduledReminder => ({
  id,
  offsetHours,
  deadlineAt: deadline,
  fireAt: before(offsetHours, deadline),
  status,
});

describe("diffReminderSchedule", () => {
  const now = new Date("2027-02-01T00:00:00.000Z");

  it("plans one reminder per offset before an open deadline", () => {
    expect(
      diffReminderSchedule({
        existing: [],
        deadline: open(),
        offsetsHours: [72, 24],
        now,
      })
    ).toEqual({
      keep: [],
      create: [
        { offsetHours: 72, deadlineAt, fireAt: before(72) },
        { offsetHours: 24, deadlineAt, fireAt: before(24) },
      ],
      supersede: [],
      cancel: [],
    });
  });

  it("changes nothing when scheduling runs again with the same deadline", () => {
    expect(
      diffReminderSchedule({
        existing: [row("r72", 72), row("r24", 24)],
        deadline: open(),
        offsetsHours: [72, 24],
        now,
      })
    ).toEqual({ keep: ["r72", "r24"], create: [], supersede: [], cancel: [] });
  });

  it("skips an offset whose time has already gone, without catching up", () => {
    const diff = diffReminderSchedule({
      existing: [],
      deadline: open(),
      offsetsHours: [72, 24],
      now: new Date("2027-02-11T00:00:00.000Z"),
    });

    expect(diff.create).toEqual([
      { offsetHours: 24, deadlineAt, fireAt: before(24) },
    ]);
  });

  it("plans a reminder that is due right now", () => {
    const diff = diffReminderSchedule({
      existing: [],
      deadline: open(),
      offsetsHours: [24],
      now: before(24),
    });

    expect(diff.create.map((r) => r.offsetHours)).toEqual([24]);
  });

  it("keeps a reminder that is due but has not run yet", () => {
    expect(
      diffReminderSchedule({
        existing: [row("r24", 24)],
        deadline: open(),
        offsetsHours: [72, 24],
        now: new Date(before(24).getTime() + 60_000),
      })
    ).toEqual({ keep: ["r24"], create: [], supersede: [], cancel: [] });
  });

  it("supersedes the old reminders and plans new ones when the deadline moves", () => {
    const diff = diffReminderSchedule({
      existing: [row("r72", 72), row("r24", 24)],
      deadline: open(movedDeadlineAt),
      offsetsHours: [72, 24],
      now,
    });

    expect(diff.keep).toEqual([]);
    expect(diff.supersede).toEqual(["r72", "r24"]);
    expect(diff.create).toEqual([
      {
        offsetHours: 72,
        deadlineAt: movedDeadlineAt,
        fireAt: before(72, movedDeadlineAt),
      },
      {
        offsetHours: 24,
        deadlineAt: movedDeadlineAt,
        fireAt: before(24, movedDeadlineAt),
      },
    ]);
  });

  it("follows a change of offsets in settings", () => {
    expect(
      diffReminderSchedule({
        existing: [row("r72", 72), row("r24", 24)],
        deadline: open(),
        offsetsHours: [48, 24],
        now,
      })
    ).toEqual({
      keep: ["r24"],
      create: [{ offsetHours: 48, deadlineAt, fireAt: before(48) }],
      supersede: ["r72"],
      cancel: [],
    });
  });

  it("does not plan again a reminder that already fired for this deadline", () => {
    const diff = diffReminderSchedule({
      existing: [row("r72", 72, "fired")],
      deadline: open(),
      offsetsHours: [72, 24],
      now,
    });

    expect(diff).toEqual({
      keep: [],
      create: [{ offsetHours: 24, deadlineAt, fireAt: before(24) }],
      supersede: [],
      cancel: [],
    });
  });

  it("plans again for a deadline moved away and back, unless that one fired", () => {
    const diff = diffReminderSchedule({
      existing: [
        row("old72", 72, "fired"),
        row("moved72", 72, "scheduled", movedDeadlineAt),
        row("moved24", 24, "scheduled", movedDeadlineAt),
      ],
      deadline: open(),
      offsetsHours: [72, 24],
      now,
    });

    expect(diff.supersede).toEqual(["moved72", "moved24"]);
    expect(diff.create.map((r) => r.offsetHours)).toEqual([24]);
  });

  it("supersedes everything when the deadline is removed", () => {
    expect(
      diffReminderSchedule({
        existing: [row("r72", 72), row("r24", 24, "fired")],
        deadline: { kind: "none" },
        offsetsHours: [72, 24],
        now,
      })
    ).toEqual({ keep: [], create: [], supersede: ["r72"], cancel: [] });
  });

  it("cancels every scheduled reminder when the subject is cancelled", () => {
    expect(
      diffReminderSchedule({
        existing: [row("r72", 72, "fired"), row("r24", 24)],
        deadline: { kind: "cancelled" },
        offsetsHours: [72, 24],
        now,
      })
    ).toEqual({ keep: [], create: [], supersede: [], cancel: ["r24"] });
  });

  it("plans nothing new once the deadline has passed", () => {
    expect(
      diffReminderSchedule({
        existing: [],
        deadline: open(),
        offsetsHours: [72, 24],
        now: deadlineAt,
      }).create
    ).toEqual([]);
  });
});

describe("checkReminderAtRunTime", () => {
  const reminder = row("r24", 24);
  const dueAt = reminder.fireAt;
  const check = (
    overrides: Partial<Parameters<typeof checkReminderAtRunTime>[0]> = {}
  ) =>
    checkReminderAtRunTime({
      reminder,
      deadline: open(),
      offsetsHours: [72, 24],
      nearerDue: false,
      now: dueAt,
      ...overrides,
    });

  it("runs a scheduled reminder at its time while nothing changed", () => {
    expect(check()).toEqual({ run: true, firstRun: true });
  });

  it("supersedes it when the deadline moved after it was scheduled", () => {
    expect(check({ deadline: open(movedDeadlineAt) })).toEqual({
      run: false,
      reason: "deadline_changed",
      status: "superseded",
    });
  });

  it("supersedes it when the deadline was removed", () => {
    expect(check({ deadline: { kind: "none" } })).toEqual({
      run: false,
      reason: "deadline_removed",
      status: "superseded",
    });
  });

  it("supersedes it when its offset was taken out of settings", () => {
    expect(check({ offsetsHours: [72, 48] })).toEqual({
      run: false,
      reason: "offset_removed",
      status: "superseded",
    });
  });

  it("supersedes it when a nearer reminder for the deadline is due too", () => {
    expect(check({ nearerDue: true })).toEqual({
      run: false,
      reason: "nearer_due",
      status: "superseded",
    });
  });

  it("cancels it when its subject was cancelled", () => {
    expect(check({ deadline: { kind: "cancelled" } })).toEqual({
      run: false,
      reason: "subject_cancelled",
      status: "cancelled",
    });
  });

  it("cancels it when the job runs once the deadline has passed", () => {
    expect(check({ now: deadlineAt })).toEqual({
      run: false,
      reason: "deadline_passed",
      status: "cancelled",
    });
  });

  it("waits when the job runs early", () => {
    expect(check({ now: new Date(dueAt.getTime() - 1) })).toEqual({
      run: false,
      reason: "not_due",
      status: null,
    });
  });

  it("does nothing once superseded or cancelled", () => {
    for (const status of ["superseded", "cancelled"] as const) {
      expect(check({ reminder: { ...reminder, status } })).toEqual({
        run: false,
        reason: status,
        status: null,
      });
    }
  });

  it("carries on a fired reminder (a retry) while its deadline stands", () => {
    const fired = { ...reminder, status: "fired" as const };

    expect(
      check({
        reminder: fired,
        offsetsHours: [72],
        nearerDue: true,
        now: new Date(dueAt.getTime() + hours(1)),
      })
    ).toEqual({ run: true, firstRun: false });
  });

  it("stops a fired reminder's retry once the deadline moved or passed", () => {
    const fired = { ...reminder, status: "fired" as const };

    expect(check({ reminder: fired, deadline: open(movedDeadlineAt) })).toEqual(
      { run: false, reason: "fired", status: null }
    );
    expect(check({ reminder: fired, now: deadlineAt })).toEqual({
      run: false,
      reason: "fired",
      status: null,
    });
  });
});
