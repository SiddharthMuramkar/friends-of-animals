// When to try a CDN purge again. A withdrawal of public-display consent
// must be off the CDN within the time limit (setting
// gallery.withdrawalPurgeMinutes, default 15 minutes, counted from the
// withdrawal itself, not from when the worker noticed it). Retries back off
// quickly but never land after that deadline; once it has passed, content
// managers are alerted once and retries go on every 10 minutes until a
// 24-hour hard stop, when the purge is given up with a second alert.
//
// Pure: loads under plain Node.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const PURGE_LIMITS = {
  defaultMinutes: 15,
  minMinutes: 1,
  maxMinutes: 1440,
  hardStopHours: 24,
  /** The first retry's delay; each later one doubles, up to the cap. */
  firstRetrySeconds: 15,
  maxRetrySeconds: 120,
  /** How often to keep trying once the deadline has passed. */
  overdueRetryMinutes: 10,
} as const;

export type PurgeDeadlines = { deadlineAt: Date; hardDeadlineAt: Date };

export type PurgeProgress = PurgeDeadlines & {
  /** Failed attempts so far, counting the one that just failed. */
  failedAttempts: number;
  /** Whether the overdue alert has already gone out. */
  overdueAlerted: boolean;
};

export type PurgeStep =
  | { kind: "retry"; at: Date; alert: "none" | "overdue" }
  | { kind: "give_up"; alert: "failed" };

/**
 * The deadline and the hard stop for a purge caused by a withdrawal at
 * `withdrawnAt`, with the time limit in whole minutes (1-1440).
 */
export function purgeDeadlines(
  withdrawnAt: Date,
  minutes: number
): PurgeDeadlines {
  if (
    !Number.isInteger(minutes) ||
    minutes < PURGE_LIMITS.minMinutes ||
    minutes > PURGE_LIMITS.maxMinutes
  ) {
    throw new RangeError(
      `The purge time limit must be a whole number of minutes from ${PURGE_LIMITS.minMinutes} to ${PURGE_LIMITS.maxMinutes}, not ${minutes}`
    );
  }
  const start = withdrawnAt.getTime();
  return {
    deadlineAt: new Date(start + minutes * MINUTE),
    hardDeadlineAt: new Date(start + PURGE_LIMITS.hardStopHours * HOUR),
  };
}

/** What to do after an attempt that failed at `now`. */
export function nextPurgeStep(progress: PurgeProgress, now: Date): PurgeStep {
  if (
    !Number.isInteger(progress.failedAttempts) ||
    progress.failedAttempts < 1
  ) {
    throw new RangeError("nextPurgeStep is only asked after a failed attempt");
  }
  const time = now.getTime();
  const deadline = progress.deadlineAt.getTime();
  const hardStop = progress.hardDeadlineAt.getTime();
  if (time >= hardStop) return { kind: "give_up", alert: "failed" };

  if (time < deadline) {
    const delay = Math.min(
      PURGE_LIMITS.firstRetrySeconds *
        SECOND *
        2 ** (progress.failedAttempts - 1),
      PURGE_LIMITS.maxRetrySeconds * SECOND
    );
    return {
      kind: "retry",
      at: new Date(Math.min(time + delay, deadline)),
      alert: "none",
    };
  }

  return {
    kind: "retry",
    at: new Date(
      Math.min(time + PURGE_LIMITS.overdueRetryMinutes * MINUTE, hardStop)
    ),
    alert: progress.overdueAlerted ? "none" : "overdue",
  };
}
