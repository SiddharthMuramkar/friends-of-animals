// Ledger periods and date filters. A posting belongs to the calendar month
// it happened in, in India Standard Time: FOA's books, the period lock
// (#109) and the transparency page (#110) all count IST months. India has
// kept UTC+05:30 all year since 1945, with no daylight saving, so the
// conversion is a fixed offset. Pure; no imports.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A ledger period: an IST calendar month, written `YYYY-MM`. */
export type PeriodMonth = string;

/** An IST calendar date, written `YYYY-MM-DD` (what `<input type="date">` sends). */
export type IstDate = string;

const PERIOD_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function istWallClock(at: Date): Date {
  const ms = at.getTime();
  if (Number.isNaN(ms)) throw new RangeError("Invalid Date");
  return new Date(ms + IST_OFFSET_MS);
}

/** The period an instant falls in. */
export function periodMonthOf(at: Date): PeriodMonth {
  return istWallClock(at).toISOString().slice(0, 7);
}

export function isPeriodMonth(value: string): boolean {
  return PERIOD_MONTH.test(value);
}

/** The IST calendar date of an instant. */
export function istDateOf(at: Date): IstDate {
  return istWallClock(at).toISOString().slice(0, 10);
}

export type IstDateResult =
  | { ok: true; start: Date }
  | { ok: false; error: "invalid_date" };

/** Reads `YYYY-MM-DD` as the instant that day starts in IST. */
export function parseIstDate(value: string): IstDateResult {
  const match = ISO_DATE.exec(value);
  if (!match) return { ok: false, error: "invalid_date" };
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const midnightUtc = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls over (30 February becomes 2 March), so a date that
  // doesn't read back the same never existed.
  if (
    midnightUtc.getUTCFullYear() !== year ||
    midnightUtc.getUTCMonth() !== month - 1 ||
    midnightUtc.getUTCDate() !== day
  ) {
    return { ok: false, error: "invalid_date" };
  }
  return { ok: true, start: new Date(midnightUtc.getTime() - IST_OFFSET_MS) };
}

export type IstDateRangeResult =
  | { ok: true; fromInclusive: Date | null; toExclusive: Date | null }
  | { ok: false; error: "invalid_date" | "range_reversed" };

/**
 * The instants a "from date, to date" filter covers: whole IST days, both
 * ends included, so `occurred_at >= fromInclusive AND occurred_at <
 * toExclusive`. A missing or empty end is open.
 */
export function istDateRange(input: {
  from?: string;
  to?: string;
}): IstDateRangeResult {
  let fromInclusive: Date | null = null;
  let toExclusive: Date | null = null;
  if (input.from) {
    const from = parseIstDate(input.from);
    if (!from.ok) return from;
    fromInclusive = from.start;
  }
  if (input.to) {
    const to = parseIstDate(input.to);
    if (!to.ok) return to;
    toExclusive = new Date(to.start.getTime() + DAY_MS);
  }
  if (fromInclusive && toExclusive && fromInclusive >= toExclusive) {
    return { ok: false, error: "range_reversed" };
  }
  return { ok: true, fromInclusive, toExclusive };
}

// Month arithmetic for the period lock and budgets (#109). Months are
// fixed-width `YYYY-MM`, so they sort as text.

const MONTH_PARTS = /^(\d{4})-(0[1-9]|1[0-2])$/;

function monthParts(month: PeriodMonth): { year: number; month: number } {
  const match = MONTH_PARTS.exec(month);
  if (!match) throw new RangeError(`Not a period month (YYYY-MM): ${month}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function formatMonth(year: number, month: number): PeriodMonth {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Midnight IST on the 1st of `month`, as an instant. */
export function periodStart(month: PeriodMonth): Date {
  monthParts(month);
  const first = parseIstDate(`${month}-01`);
  if (!first.ok) throw new RangeError(`Not a period month (YYYY-MM): ${month}`);
  return first.start;
}

export function nextPeriodMonth(month: PeriodMonth): PeriodMonth {
  const { year, month: m } = monthParts(month);
  return m === 12 ? formatMonth(year + 1, 1) : formatMonth(year, m + 1);
}

export function previousPeriodMonth(month: PeriodMonth): PeriodMonth {
  const { year, month: m } = monthParts(month);
  return m === 1 ? formatMonth(year - 1, 12) : formatMonth(year, m - 1);
}

/** Negative when `a` is earlier, positive when later, 0 when equal. */
export function comparePeriodMonths(a: PeriodMonth, b: PeriodMonth): number {
  monthParts(a);
  monthParts(b);
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

/** Every month from `from` to `to`, both included; empty when reversed. */
export function monthsBetween(
  from: PeriodMonth,
  to: PeriodMonth
): PeriodMonth[] {
  const months: PeriodMonth[] = [];
  for (
    let month = from;
    comparePeriodMonths(month, to) <= 0;
    month = nextPeriodMonth(month)
  ) {
    months.push(month);
  }
  return months;
}

/** April to March of the Indian financial year `month` falls in. */
export function financialYearMonths(month: PeriodMonth): PeriodMonth[] {
  const { year, month: m } = monthParts(month);
  const startYear = m >= 4 ? year : year - 1;
  return monthsBetween(
    formatMonth(startYear, 4),
    formatMonth(startYear + 1, 3)
  );
}
