// Ledger periods are calendar months in India, written `YYYY-MM`. A posting
// belongs to the month its instant falls in at IST (UTC+05:30; India keeps
// no daylight saving, so the offset is fixed). Pure: time comes in as a Date.
//
// Loads under plain Node (the schema may import it): no imports at all.

/** A calendar month in India, `YYYY-MM`. */
export type PeriodMonth = string;

const PERIOD_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** IST is UTC+05:30 all year. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function isPeriodMonth(value: string): value is PeriodMonth {
  return PERIOD_MONTH.test(value);
}

function parts(month: string): { year: number; month: number } {
  const match = PERIOD_MONTH.exec(month);
  if (!match) throw new RangeError(`Not a period month (YYYY-MM): ${month}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function format(year: number, month: number): PeriodMonth {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** The month it is in India at `instant`. */
export function periodMonthOf(instant: Date): PeriodMonth {
  const inIndia = new Date(instant.getTime() + IST_OFFSET_MS);
  return format(inIndia.getUTCFullYear(), inIndia.getUTCMonth() + 1);
}

/** Midnight IST on the 1st of `month`, as an instant. */
export function periodStart(month: PeriodMonth): Date {
  const { year, month: m } = parts(month);
  return new Date(Date.UTC(year, m - 1, 1) - IST_OFFSET_MS);
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
