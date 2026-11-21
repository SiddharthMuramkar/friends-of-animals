// When the schedule moves a competition's status (#71). Publishing
// schedules one job per key date; editing a date schedules a job for the
// new instant. Each job carries the instant it was made for, so a job
// whose date has since moved is stale and does nothing. A job that is not
// stale advances every step whose key date has passed, so jobs may run in
// any order, late or twice, and the status still ends where the dates say.
//
// Later tickets reuse the pattern: a key date with no status change yet
// still gets a job, which advances nothing until a rule names its date.
//
// Plain TypeScript, no I/O: the caller passes the time from the clock.

import { KEY_DATE_KINDS, type KeyDateKind, type KeyDates } from "./key-dates";
import { canTransition, type CompetitionStatus } from "./status-machine";

/** One scheduled job: run at `dueAt`, for the key date `kind`. */
export type StatusJob = { kind: KeyDateKind; dueAt: Date };

/** One automatic move, made because `keyDate` arrived at `at`. */
export type ScheduledTransition = {
  from: CompetitionStatus;
  to: CompetitionStatus;
  keyDate: KeyDateKind;
  at: Date;
};

/** Which key date moves a competition out of which status. */
const RULES: readonly {
  from: CompetitionStatus;
  to: CompetitionStatus;
  keyDate: KeyDateKind;
}[] = [
  { from: "published", to: "registration_open", keyDate: "registration_opens" },
  {
    from: "registration_open",
    to: "registration_closed",
    keyDate: "registration_closes",
  },
];

for (const rule of RULES) {
  if (!canTransition(rule.from, rule.to, "schedule")) {
    throw new Error(
      `The status machine does not let the schedule move ${rule.from} to ${rule.to}`
    );
  }
}

function sameInstant(a: Date | undefined, b: Date | undefined): boolean {
  return a?.getTime() === b?.getTime();
}

/**
 * The jobs to schedule when a competition is published: one for each key
 * date that is set. A draft has none.
 */
export function statusJobs(
  status: CompetitionStatus,
  keyDates: KeyDates
): StatusJob[] {
  if (status === "draft") return [];
  return KEY_DATE_KINDS.flatMap((kind) => {
    const dueAt = keyDates[kind];
    return dueAt ? [{ kind, dueAt }] : [];
  });
}

/**
 * The jobs to schedule after a published competition's dates are edited:
 * one for each date that was added or moved. The jobs of moved or removed
 * dates are left in place and go stale (`isStale`).
 */
export function rescheduledJobs(
  status: CompetitionStatus,
  before: KeyDates,
  after: KeyDates
): StatusJob[] {
  return statusJobs(status, after).filter(
    (job) => !sameInstant(before[job.kind], job.dueAt)
  );
}

/** Whether the job's key date has moved or gone since it was scheduled. */
export function isStale(job: StatusJob, keyDates: KeyDates): boolean {
  return !sameInstant(keyDates[job.kind], job.dueAt);
}

/**
 * Every automatic move due at `now`, in order. The time of a key date
 * counts as passed at that very instant. Stops at the first step whose
 * date is unset or still ahead.
 */
export function dueTransitions(
  status: CompetitionStatus,
  keyDates: KeyDates,
  now: Date
): ScheduledTransition[] {
  const transitions: ScheduledTransition[] = [];
  let current = status;
  for (;;) {
    const rule = RULES.find((r) => r.from === current);
    const at = rule && keyDates[rule.keyDate];
    if (!rule || !at || at.getTime() > now.getTime()) return transitions;
    transitions.push({
      from: rule.from,
      to: rule.to,
      keyDate: rule.keyDate,
      at,
    });
    current = rule.to;
  }
}

/** What a status job does when it runs. */
export type StatusJobPlan =
  /** Its key date moved or went; another job (or none) covers it. */
  | { kind: "stale" }
  /** It ran before its instant; schedule it again for `dueAt`. */
  | { kind: "early"; dueAt: Date }
  /** Make these moves, in order. Empty when nothing is due. */
  | { kind: "advance"; transitions: ScheduledTransition[] };

/** Decides what a status job does for the competition as it is now. */
export function planStatusJob(
  job: StatusJob,
  competition: { status: CompetitionStatus; keyDates: KeyDates },
  now: Date
): StatusJobPlan {
  if (isStale(job, competition.keyDates)) return { kind: "stale" };
  if (now.getTime() < job.dueAt.getTime()) {
    return { kind: "early", dueAt: job.dueAt };
  }
  return {
    kind: "advance",
    transitions: dueTransitions(competition.status, competition.keyDates, now),
  };
}

/** The next automatic move, for a public countdown. */
export type UpcomingChange = {
  /** `scheduled`: `at` is ahead. `due`: `at` has passed, the move has not run yet. */
  kind: "scheduled" | "due";
  to: CompetitionStatus;
  at: Date;
} | null;

/**
 * The next automatic move from `status`, or null when none is ahead. Once
 * its instant has passed but the status has not moved yet, it is `due`, so
 * a page says "opening now" instead of counting below zero.
 */
export function upcomingChange(
  status: CompetitionStatus,
  keyDates: KeyDates,
  now: Date
): UpcomingChange {
  const rule = RULES.find((r) => r.from === status);
  const at = rule && keyDates[rule.keyDate];
  if (!rule || !at) return null;
  return {
    kind: at.getTime() > now.getTime() ? "scheduled" : "due",
    to: rule.to,
    at,
  };
}
