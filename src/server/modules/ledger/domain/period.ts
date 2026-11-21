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
