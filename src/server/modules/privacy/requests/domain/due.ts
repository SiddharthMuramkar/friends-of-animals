// When a rights request is due, and how the grievance queue flags it
// (#115). A request is due a fixed number of days after it was filed
// (`privacy.requestDueDays`, 30 by default until counsel confirms the DPDP
// maximum, HR-30/HR-51). An open request is overdue from the instant its
// due time passes; a closed one never is. Days left count India's calendar
// days, so "due today" means the same thing to every officer.
//
// Pure, and loads under plain Node: the daily overdue schedule runs it.

import { isOpenRequest, type PrivacyRequestStatus } from "./request-status";

const DAY_MS = 24 * 60 * 60 * 1000;

/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** When a request filed at `filedAt` is due. */
export function requestDueAt(filedAt: Date, dueDays: number): Date {
  if (!Number.isInteger(dueDays) || dueDays < 1) {
    throw new RangeError(
      `A request's due period is a whole number of days, at least 1 (got ${dueDays})`
    );
  }
  return new Date(filedAt.getTime() + dueDays * DAY_MS);
}

/** The IST calendar day `at` falls on, as a day count since 1970. */
function istDay(at: Date): number {
  return Math.floor((at.getTime() + IST_OFFSET_MS) / DAY_MS);
}

export type QueueFlags =
  | { open: true; overdue: boolean; daysLeft: number }
  | { open: false; overdue: false; daysLeft: null };

/**
 * What the queue shows for one request at `now`: whether it is open,
 * overdue, and how many IST calendar days are left (0 = due today,
 * negative = days late).
 */
export function queueFlags(input: {
  status: PrivacyRequestStatus;
  dueAt: Date;
  now: Date;
}): QueueFlags {
  const { status, dueAt, now } = input;
  if (!isOpenRequest(status)) {
    return { open: false, overdue: false, daysLeft: null };
  }
  return {
    open: true,
    overdue: now.getTime() > dueAt.getTime(),
    daysLeft: istDay(dueAt) - istDay(now),
  };
}

export type OverdueDigest = {
  userId: string;
  /** Every overdue request in the queue. */
  overdue: number;
  /** Of those, the ones assigned to this officer. */
  assignedToYou: number;
};

/**
 * One in-app nudge per grievance officer for the daily overdue run: counts
 * only, never who the requests are about. Empty when nothing is overdue.
 */
export function overdueDigests(input: {
  now: Date;
  officerIds: readonly string[];
  requests: readonly {
    status: PrivacyRequestStatus;
    dueAt: Date;
    assignedToUserId: string | null;
  }[];
}): OverdueDigest[] {
  const overdue = input.requests.filter(
    (request) =>
      queueFlags({
        status: request.status,
        dueAt: request.dueAt,
        now: input.now,
      }).overdue
  );
  if (overdue.length === 0) return [];
  return input.officerIds.map((userId) => ({
    userId,
    overdue: overdue.length,
    assignedToYou: overdue.filter(
      (request) => request.assignedToUserId === userId
    ).length,
  }));
}
