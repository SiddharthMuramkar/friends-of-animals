// Ledger period status (#109): each month is open or locked. Finance locks a
// reconciled month; from then on nothing posts into it, and corrections go
// in as reversals in an open month. Pure: the caller loads the months the
// ledger knows about and passes the time in.
//
// Locked months always form a prefix of the ledger's months. The latest
// locked month is the "lock line": that month and every month before it
// are closed, whether or not they have a row. So months lock in order and
// unlock in reverse order, and a published (locked) figure can't change
// because an earlier month was still open.
//
// Loads under plain Node (the schema builds its enum from
// LEDGER_PERIOD_STATUSES): relative imports only.

import {
  comparePeriodMonths,
  hasPeriodStarted,
  nextPeriodMonth,
  periodMonthOf,
  type PeriodMonth,
} from "./period";

export const LEDGER_PERIOD_STATUSES = ["open", "locked"] as const;

export type LedgerPeriodStatus = (typeof LEDGER_PERIOD_STATUSES)[number];

/** Every allowed change, `null` being "no row yet". Nothing else is allowed. */
export const LEDGER_PERIOD_TRANSITIONS: readonly {
  from: LedgerPeriodStatus | null;
  to: LedgerPeriodStatus;
}[] = [
  { from: null, to: "open" },
  { from: "open", to: "locked" },
  { from: "locked", to: "open" },
];

export function canTransitionLedgerPeriod(
  from: LedgerPeriodStatus | null,
  to: LedgerPeriodStatus
): boolean {
  return LEDGER_PERIOD_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to
  );
}

export class LedgerPeriodTransitionError extends Error {
  constructor(
    readonly from: LedgerPeriodStatus | null,
    readonly to: LedgerPeriodStatus
  ) {
    super(`Ledger period can't go ${from ?? "none"} -> ${to}`);
    this.name = "LedgerPeriodTransitionError";
  }
}

export function assertLedgerPeriodTransition(
  from: LedgerPeriodStatus | null,
  to: LedgerPeriodStatus
): void {
  if (!canTransitionLedgerPeriod(from, to)) {
    throw new LedgerPeriodTransitionError(from, to);
  }
}

/** A month the ledger has a row for. */
export type KnownPeriod = { month: PeriodMonth; status: LedgerPeriodStatus };

/** The latest locked month, or null when none is locked. */
export function lockLine(periods: readonly KnownPeriod[]): PeriodMonth | null {
  let line: PeriodMonth | null = null;
  for (const period of periods) {
    if (
      period.status === "locked" &&
      (line === null || comparePeriodMonths(period.month, line) > 0)
    ) {
      line = period.month;
    }
  }
  return line;
}

/** Whether nothing may post into `month`: it is on or before the lock line. */
export function isPeriodClosed(
  month: PeriodMonth,
  periods: readonly KnownPeriod[]
): boolean {
  const line = lockLine(periods);
  return line !== null && comparePeriodMonths(month, line) <= 0;
}

export type PeriodCheck =
  | { ok: true }
  | { ok: false; reason: "period_not_started" | "period_locked" }
  | { ok: false; reason: "period_not_locked" }
  | {
      ok: false;
      reason: "earlier_period_open" | "later_period_locked";
      month: PeriodMonth;
    };

/**
 * May `month` be locked now? Checked when the lock is requested and again
 * when it is approved, since the months may have moved in between.
 */
export function checkPeriodLock(input: {
  month: PeriodMonth;
  periods: readonly KnownPeriod[];
  now: Date;
}): PeriodCheck {
  const { month, periods, now } = input;
  if (!hasPeriodStarted(month, now)) {
    return { ok: false, reason: "period_not_started" };
  }
  if (isPeriodClosed(month, periods)) {
    return { ok: false, reason: "period_locked" };
  }
  const earlierOpen = periods
    .filter(
      (period) =>
        period.status === "open" && comparePeriodMonths(period.month, month) < 0
    )
    .map((period) => period.month)
    .sort(comparePeriodMonths)[0];
  if (earlierOpen !== undefined) {
    return { ok: false, reason: "earlier_period_open", month: earlierOpen };
  }
  return { ok: true };
}

/** May `month` be unlocked? Only the latest locked month may. */
export function checkPeriodUnlock(input: {
  month: PeriodMonth;
  periods: readonly KnownPeriod[];
}): PeriodCheck {
  const { month, periods } = input;
  const row = periods.find((period) => period.month === month);
  if (row?.status !== "locked") {
    return { ok: false, reason: "period_not_locked" };
  }
  const line = lockLine(periods);
  if (line !== null && comparePeriodMonths(line, month) > 0) {
    return { ok: false, reason: "later_period_locked", month: line };
  }
  return { ok: true };
}

export type PostingPeriod = {
  periodMonth: PeriodMonth;
  lateAdjustment: boolean;
  originalPeriodMonth: PeriodMonth | null;
};

/**
 * Where an automatic posting (a gateway capture or refund) for `month`
 * goes. It can't be refused, so a posting for a closed month lands in the
 * first month after the lock line, marked as a late adjustment that
 * remembers its own month. Manual entries and reversals aimed at a closed
 * month are refused instead (`isPeriodClosed`).
 */
export function postingPeriodFor(input: {
  month: PeriodMonth;
  periods: readonly KnownPeriod[];
}): PostingPeriod {
  const { month, periods } = input;
  const line = lockLine(periods);
  if (line === null || comparePeriodMonths(month, line) > 0) {
    return {
      periodMonth: month,
      lateAdjustment: false,
      originalPeriodMonth: null,
    };
  }
  return {
    periodMonth: nextPeriodMonth(line),
    lateAdjustment: true,
    originalPeriodMonth: month,
  };
}

/**
 * Whether a posting counts in a later month than the one it happened in:
 * an automatic posting that arrived after its month was locked.
 */
export function isLateAdjustment(posting: {
  occurredAt: Date;
  periodMonth: PeriodMonth;
}): boolean {
  return (
    comparePeriodMonths(
      posting.periodMonth,
      periodMonthOf(posting.occurredAt)
    ) > 0
  );
}
