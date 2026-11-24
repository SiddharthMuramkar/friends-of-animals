// Keeping a subject's reminders in step with its deadline (#84). Every
// reminder row records the deadline and the offset it was planned for.
// When a deadline, the offsets or the subject change, scheduling runs
// again: matching reminders stay, the rest are superseded (or cancelled,
// with their subject) and new ones planned. When a reminder's job runs it
// checks again, against things as they are then, so a job left over from
// an old plan does nothing.
//
// Pure: no I/O, no "server-only". The caller passes the time from the clock.

export const REMINDER_STATUSES = [
  /** Waiting for its fire time. */
  "scheduled",
  /** Its run went out: whoever owed the deadline then was reminded. */
  "fired",
  /** It will never go: its subject was cancelled, or its deadline passed first. */
  "cancelled",
  /** A newer plan replaced it: the deadline or the offsets changed. */
  "superseded",
] as const;

export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/** A subject's deadline as it stands now. */
export type Deadline =
  | { kind: "open"; at: Date }
  /** None set, or the subject isn't live yet (a draft). */
  | { kind: "none" }
  /** The subject was cancelled: its reminders never go. */
  | { kind: "cancelled" };

export type ScheduledReminder = {
  id: string;
  offsetHours: number;
  /** The deadline this reminder was planned for. */
  deadlineAt: Date;
  fireAt: Date;
  status: ReminderStatus;
};

export type ReminderToCreate = {
  offsetHours: number;
  deadlineAt: Date;
  fireAt: Date;
};

export type ReminderScheduleDiff = {
  /** Ids of scheduled reminders that already match the plan. */
  keep: string[];
  /** Soonest first. */
  create: ReminderToCreate[];
  /** Ids of scheduled reminders that no longer match: their jobs do nothing. */
  supersede: string[];
  /** Ids of scheduled reminders of a cancelled subject. */
  cancel: string[];
};

const HOUR_MS = 60 * 60 * 1000;

const sameInstant = (a: Date, b: Date) => a.getTime() === b.getTime();

/**
 * Compares one reminder's rows for one subject with the plan for its
 * deadline and offsets now. A scheduled row for this deadline and a
 * current offset stays, even once due (its job is about to run). An
 * offset whose time has gone is skipped rather than sent late, so
 * publishing or moving a deadline close to it never sends a burst; one
 * that already fired for this deadline is not planned again.
 */
export function diffReminderSchedule({
  existing,
  deadline,
  offsetsHours,
  now,
}: {
  existing: readonly ScheduledReminder[];
  deadline: Deadline;
  offsetsHours: readonly number[];
  now: Date;
}): ReminderScheduleDiff {
  const scheduled = existing.filter((r) => r.status === "scheduled");
  if (deadline.kind === "cancelled") {
    return {
      keep: [],
      create: [],
      supersede: [],
      cancel: scheduled.map((r) => r.id),
    };
  }
  const deadlineAt = deadline.kind === "open" ? deadline.at : null;
  const current = (r: ScheduledReminder) =>
    deadlineAt !== null &&
    sameInstant(r.deadlineAt, deadlineAt) &&
    offsetsHours.includes(r.offsetHours);

  const keep = scheduled.filter(current).map((r) => r.id);
  const supersede = scheduled.filter((r) => !current(r)).map((r) => r.id);
  const create: ReminderToCreate[] = [];
  if (deadlineAt !== null && deadlineAt.getTime() > now.getTime()) {
    const planned = existing.filter(
      (r) => (r.status === "scheduled" || r.status === "fired") && current(r)
    );
    for (const offsetHours of offsetsHours) {
      const fireAt = new Date(deadlineAt.getTime() - offsetHours * HOUR_MS);
      if (fireAt.getTime() < now.getTime()) continue;
      if (planned.some((r) => r.offsetHours === offsetHours)) continue;
      create.push({ offsetHours, deadlineAt, fireAt });
    }
    create.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  }
  return { keep, create, supersede, cancel: [] };
}

export type RunTimeDecision =
  /** `firstRun`: mark it fired; otherwise it is a fired one's retry. */
  | { run: true; firstRun: boolean }
  | {
      run: false;
      reason:
        | Exclude<ReminderStatus, "scheduled">
        | "deadline_removed"
        | "deadline_changed"
        | "deadline_passed"
        | "offset_removed"
        | "nearer_due"
        | "subject_cancelled"
        | "not_due";
      /** What the row becomes; null to leave it as it is. */
      status: Exclude<ReminderStatus, "scheduled" | "fired"> | null;
    };

/**
 * Whether a reminder's job should send now. A scheduled reminder sends
 * at or after its fire time while its deadline is unchanged and still
 * ahead, its offset is still in settings, and no nearer reminder for the
 * same deadline is due too (after an outage only the nearest goes). A
 * fired one carries on (a retry of its sends) while its deadline stands.
 * Who owes the deadline is checked after this, also at run time.
 */
export function checkReminderAtRunTime({
  reminder,
  deadline,
  offsetsHours,
  nearerDue,
  now,
}: {
  reminder: ScheduledReminder;
  deadline: Deadline;
  offsetsHours: readonly number[];
  /** A nearer reminder for this deadline has fired or is due now. */
  nearerDue: boolean;
  now: Date;
}): RunTimeDecision {
  const stands =
    deadline.kind === "open" &&
    sameInstant(deadline.at, reminder.deadlineAt) &&
    now.getTime() < deadline.at.getTime();
  if (reminder.status === "fired") {
    return stands
      ? { run: true, firstRun: false }
      : { run: false, reason: "fired", status: null };
  }
  if (reminder.status !== "scheduled") {
    return { run: false, reason: reminder.status, status: null };
  }
  if (deadline.kind === "cancelled") {
    return { run: false, reason: "subject_cancelled", status: "cancelled" };
  }
  if (deadline.kind === "none") {
    return { run: false, reason: "deadline_removed", status: "superseded" };
  }
  if (!sameInstant(deadline.at, reminder.deadlineAt)) {
    return { run: false, reason: "deadline_changed", status: "superseded" };
  }
  if (now.getTime() >= deadline.at.getTime()) {
    return { run: false, reason: "deadline_passed", status: "cancelled" };
  }
  if (!offsetsHours.includes(reminder.offsetHours)) {
    return { run: false, reason: "offset_removed", status: "superseded" };
  }
  if (now.getTime() < reminder.fireAt.getTime()) {
    return { run: false, reason: "not_due", status: null };
  }
  if (nearerDue) {
    return { run: false, reason: "nearer_due", status: "superseded" };
  }
  return { run: true, firstRun: true };
}
