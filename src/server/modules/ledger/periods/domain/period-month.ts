// Ledger periods are calendar months in India, written `YYYY-MM`. Which
// month an instant falls in is the ledger's own rule (../../domain/period.ts,
// #105, re-exported here); this file adds the month arithmetic the period
// lock needs. Pure: time comes in as a Date.
//
// Loads under plain Node (the schema imports it through period-status.ts):
// relative imports only.

import {
  isPeriodMonth as isLedgerPeriodMonth,
  parseIstDate,
  periodMonthOf,
  type PeriodMonth,
} from "../../domain/period";

export { periodMonthOf, type PeriodMonth };

const PERIOD_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriodMonth(value: string): value is PeriodMonth {
  return isLedgerPeriodMonth(value);
}

function parts(month: string): { year: number; month: number } {
  const match = PERIOD_MONTH.exec(month);
  if (!match) throw new RangeError(`Not a period month (YYYY-MM): ${month}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function format(year: number, month: number): PeriodMonth {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Midnight IST on the 1st of `month`, as an instant. */
export function periodStart(month: PeriodMonth): Date {
  parts(month);
  const first = parseIstDate(`${month}-01`);
  if (!first.ok) throw new RangeError(`Not a period month (YYYY-MM): ${month}`);
  return first.start;
}

export function nextPeriodMonth(month: PeriodMonth): PeriodMonth {
  const { year, month: m } = parts(month);
  return m === 12 ? format(year + 1, 1) : format(year, m + 1);
}

export function previousPeriodMonth(month: PeriodMonth): PeriodMonth {
  const { year, month: m } = parts(month);
  return m === 1 ? format(year - 1, 12) : format(year, m - 1);
}

/** Negative when `a` is earlier, positive when later, 0 when equal. */
export function comparePeriodMonths(a: PeriodMonth, b: PeriodMonth): number {
  parts(a);
  parts(b);
  // Fixed-width `YYYY-MM` sorts as text.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether `month` has begun at `now`. A month can be locked once it has
 * begun, not only once it has ended: finance may close the current month
 * early, and two approvers protect that.
 */
export function hasPeriodStarted(month: PeriodMonth, now: Date): boolean {
  return periodStart(month).getTime() <= now.getTime();
}
