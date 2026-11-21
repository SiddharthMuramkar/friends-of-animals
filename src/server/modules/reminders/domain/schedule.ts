// Keeping a competition's reminders in step with its deadline (#84).
// Every scheduled reminder records the deadline it was planned for. When a
// deadline or the offsets change, scheduling runs again: matching reminders
// stay, the rest are superseded and new ones planned. When a reminder's job
// runs it checks again, against the deadline as it is now, so a job left
// over from an old deadline does nothing.

import type { PlannedReminder } from "./offsets";

export type ReminderStatus = "scheduled" | "fired" | "cancelled" | "superseded";

export type ScheduledReminder = {
  id: string;
  offsetHours: number;
  /** The deadline this reminder was planned for. */
  deadlineAt: Date;
  fireAt: Date;
  status: ReminderStatus;
};

export type ReminderToCreate = PlannedReminder & { deadlineAt: Date };

export type ReminderScheduleDiff = {
  /** Ids of scheduled reminders that already match the plan. */
  keep: string[];
  create: ReminderToCreate[];
  /** Ids of scheduled reminders that no longer match: their jobs do nothing. */
  supersede: string[];
};

const sameInstant = (a: Date, b: Date) => a.getTime() === b.getTime();

const matches = (
  reminder: ScheduledReminder,
  deadlineAt: Date,
  offsetHours: number
) =>
  reminder.offsetHours === offsetHours &&
  sameInstant(reminder.deadlineAt, deadlineAt);

/**
 * Compares a reminder's rows for one competition with the plan for its
 * current deadline. A reminder that already fired for this deadline and
 * offset is not planned again.
 */
export function diffReminderSchedule({
  existing,
  deadlineAt,
  planned,
}: {
  existing: readonly ScheduledReminder[];
  deadlineAt: Date | null;
  planned: readonly PlannedReminder[];
}): ReminderScheduleDiff {
  const scheduled = existing.filter((r) => r.status === "scheduled");
  const fired = existing.filter((r) => r.status === "fired");
  const keep: string[] = [];
  const create: ReminderToCreate[] = [];

  if (deadlineAt !== null) {
    for (const plan of planned) {
      const current = scheduled.find((r) =>
        matches(r, deadlineAt, plan.offsetHours)
      );
      if (current) {
        keep.push(current.id);
      } else if (!fired.some((r) => matches(r, deadlineAt, plan.offsetHours))) {
        create.push({ ...plan, deadlineAt });
      }
    }
  }

  const supersede = scheduled
    .filter((reminder) => !keep.includes(reminder.id))
    .map((reminder) => reminder.id);
  return { keep, create, supersede };
}

export type RunTimeDecision =
  | { run: true }
  | {
      run: false;
      reason:
        | Exclude<ReminderStatus, "scheduled">
        | "deadline_removed"
        | "deadline_changed"
        | "deadline_passed"
        | "not_due";
    };

/**
 * Whether a reminder's job should send now. Only a still-scheduled
 * reminder whose deadline is unchanged and still ahead, at or after its
 * fire time, sends. Who owes the deadline is checked after this, also at
 * run time.
 */
export function checkReminderAtRunTime({
  reminder,
  currentDeadlineAt,
  now,
}: {
  reminder: ScheduledReminder;
  currentDeadlineAt: Date | null;
  now: Date;
}): RunTimeDecision {
  if (reminder.status !== "scheduled") {
    return { run: false, reason: reminder.status };
  }
  if (currentDeadlineAt === null) {
    return { run: false, reason: "deadline_removed" };
  }
  if (!sameInstant(currentDeadlineAt, reminder.deadlineAt)) {
    return { run: false, reason: "deadline_changed" };
  }
  if (now.getTime() >= currentDeadlineAt.getTime()) {
    return { run: false, reason: "deadline_passed" };
  }
  if (now.getTime() < reminder.fireAt.getTime()) {
    return { run: false, reason: "not_due" };
  }
  return { run: true };
}
