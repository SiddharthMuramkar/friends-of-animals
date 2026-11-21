// Volunteer hours (#124): what a volunteer may log against a task, how a
// community manager decides them, and what counts toward the total. Only
// approved hours count, for the total and for the certificate.
//
// Pure: the use cases load the task, the assignment and the day's other
// entries, then ask these functions. Loads under plain Node, so the schema
// can build its pgEnum from the tuple below.

import { acceptsHours, type VolunteerTaskStatus } from "./task-status";

/** Every status, declared now so the enum never grows in a later run. */
export const VOLUNTEER_HOURS_STATUSES = [
  "submitted",
  "approved",
  "rejected",
] as const;

export type VolunteerHoursStatus = (typeof VOLUNTEER_HOURS_STATUSES)[number];

type Transition = {
  /** `null` is an entry that does not exist yet. */
  from: VolunteerHoursStatus | null;
  to: VolunteerHoursStatus;
};

/** Every allowed move. Anything not listed is forbidden. */
export const HOURS_TRANSITIONS: readonly Transition[] = [
  { from: null, to: "submitted" },
  // A community manager decides once; both outcomes are final.
  { from: "submitted", to: "approved" },
  { from: "submitted", to: "rejected" },
];

export function canTransitionHours(
  from: VolunteerHoursStatus | null,
  to: VolunteerHoursStatus
): boolean {
  return HOURS_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to
  );
}

/** One entry is at most a day; so is everything logged for one day. */
export const MAX_MINUTES_PER_DAY = 24 * 60;

export const MAX_NOTE_LENGTH = 500;

export const MAX_REJECT_REASON_LENGTH = 500;

/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The calendar date in India at `instant`, as `YYYY-MM-DD`. */
export function istDate(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whether `value` is a real calendar date written `YYYY-MM-DD`. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** Characters as Postgres's `char_length` counts them: code points. */
function characterCount(text: string): number {
  return Array.from(text).length;
}

export type HoursEntryProblem =
  | "not_assigned"
  | "task_not_accepting_hours"
  | "minutes_out_of_range"
  | "note_too_long"
  | "worked_on_invalid"
  | "worked_on_in_future"
  | "before_assignment"
  | "after_unassignment"
  | "day_limit_exceeded";

export type HoursEntryCheck =
  | { ok: true }
  | { ok: false; problem: HoursEntryProblem };

/**
 * Whether a volunteer may log `minutes` on `workedOn` (a date in India)
 * against a task. The first problem found is reported; not being assigned
 * comes first, so the caller can answer it as "forbidden".
 */
export function checkHoursEntry(input: {
  minutes: number;
  /** `YYYY-MM-DD`, the day the work was done, on India's calendar. */
  workedOn: string;
  note?: string | undefined;
  taskStatus: VolunteerTaskStatus;
  /** The volunteer's assignment to the task, or null if there never was one. */
  assignment: { assignedAt: Date; unassignedAt: Date | null } | null;
  now: Date;
  /** Minutes already logged for `workedOn` and not rejected. */
  minutesLoggedThatDay: number;
}): HoursEntryCheck {
  const refuse = (problem: HoursEntryProblem): HoursEntryCheck => ({
    ok: false,
    problem,
  });
  const { minutes, workedOn, assignment } = input;
  if (!assignment) return refuse("not_assigned");
  if (!acceptsHours(input.taskStatus)) {
    return refuse("task_not_accepting_hours");
  }
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > MAX_MINUTES_PER_DAY
  ) {
    return refuse("minutes_out_of_range");
  }
  if (
    input.note !== undefined &&
    characterCount(input.note.trim()) > MAX_NOTE_LENGTH
  ) {
    return refuse("note_too_long");
  }
  // ISO dates compare correctly as strings.
  if (!isCalendarDate(workedOn)) return refuse("worked_on_invalid");
  if (workedOn > istDate(input.now)) return refuse("worked_on_in_future");
  if (workedOn < istDate(assignment.assignedAt)) {
    return refuse("before_assignment");
  }
  if (
    assignment.unassignedAt !== null &&
    workedOn > istDate(assignment.unassignedAt)
  ) {
    return refuse("after_unassignment");
  }
  if (input.minutesLoggedThatDay + minutes > MAX_MINUTES_PER_DAY) {
    return refuse("day_limit_exceeded");
  }
  return { ok: true };
}

type CountedEntry = { minutes: number; status: VolunteerHoursStatus };

/** Minutes logged for `workedOn` that still count: not rejected. */
export function minutesLoggedOn(
  entries: readonly (CountedEntry & { workedOn: string })[],
  workedOn: string
): number {
  return entries
    .filter((entry) => entry.workedOn === workedOn)
    .filter((entry) => entry.status !== "rejected")
    .reduce((sum, entry) => sum + entry.minutes, 0);
}

/** The volunteer's total: approved hours only. */
export function approvedMinutes(entries: readonly CountedEntry[]): number {
  return entries
    .filter((entry) => entry.status === "approved")
    .reduce((sum, entry) => sum + entry.minutes, 0);
}

/** A total in whole hours and the minutes left over, for display. */
export function splitMinutes(total: number): {
  hours: number;
  minutes: number;
} {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError(
      `A total of minutes is a whole number of at least 0, not ${total}`
    );
  }
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export type HoursDecision =
  | { kind: "approve" }
  | { kind: "reject"; reason: string };

export type HoursDecisionProblem =
  | "own_hours"
  | "already_decided"
  | "reason_required"
  | "reason_too_long";

export type HoursDecisionCheck =
  | { ok: true; to: "approved" | "rejected"; reason: string | null }
  | { ok: false; problem: HoursDecisionProblem };

/**
 * Whether `deciderUserId` may decide an entry in `status`, and what to
 * store. Nobody decides their own hours, whatever roles they hold; that
 * comes first, so the caller can answer it as "forbidden".
 */
export function checkHoursDecision(input: {
  status: VolunteerHoursStatus;
  volunteerUserId: string;
  deciderUserId: string;
  decision: HoursDecision;
}): HoursDecisionCheck {
  const refuse = (problem: HoursDecisionProblem): HoursDecisionCheck => ({
    ok: false,
    problem,
  });
  const { decision } = input;
  if (input.deciderUserId === input.volunteerUserId) {
    return refuse("own_hours");
  }
  const to = decision.kind === "approve" ? "approved" : "rejected";
  if (!canTransitionHours(input.status, to)) return refuse("already_decided");
  if (decision.kind === "approve") return { ok: true, to, reason: null };
  const reason = decision.reason.trim();
  if (reason === "") return refuse("reason_required");
  if (characterCount(reason) > MAX_REJECT_REASON_LENGTH) {
    return refuse("reason_too_long");
  }
  return { ok: true, to, reason };
}

/**
 * The idempotency key of the timeline entry an approval writes. It names
 * the entry, so a retried or replayed approval writes one timeline entry.
 */
export function hoursApprovedSourceKey(entryId: string): string {
  return `volunteer.hours_approved:${entryId}`;
}
