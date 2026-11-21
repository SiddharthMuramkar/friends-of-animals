// Report periods (#135). FOA leadership reads each objective report over a
// period they choose: a month, a quarter or a whole Indian financial year
// (1 April to 31 March), or a custom run of days. Days are counted in IST
// (UTC+05:30 all year, no daylight saving). Rows store UTC instants or IST
// calendar dates, so a period resolves to both: `from`..`to` for date
// columns and the half-open instant range [start, end) for timestamptz.
//
// A period still running covers days only up to today, and is compared
// with the same number of days at the start of the period before it, so
// "January so far" is set against "1-15 December", not all of December.
//
// Pure: no imports, so it loads anywhere (use cases, pages, tests).

/** IST is UTC+05:30 all year. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The longest custom range: three years of days. */
export const MAX_RANGE_DAYS = 1096;

/** The earliest financial year a report can ask for. */
const FIRST_FY = 1900;
const LAST_FY = 9998;

export type Quarter = 1 | 2 | 3 | 4;

/** The period a reader picked, before it is placed against today. */
export type PeriodChoice =
  /** A calendar month; `month` is 1-12. */
  | { kind: "month"; year: number; month: number }
  /** A quarter of a financial year: quarter 1 is April to June. */
  | { kind: "quarter"; fyStartYear: number; quarter: Quarter }
  /** The financial year whose April falls in `fyStartYear`. */
  | { kind: "fy"; fyStartYear: number }
  /** Whole days, both ends included, as `YYYY-MM-DD`. */
  | { kind: "range"; from: string; to: string };

export type ResolvedPeriod = {
  choice: PeriodChoice;
  /** The first day, `YYYY-MM-DD` in IST. */
  from: string;
  /** The last day covered: the period's last day, or today if earlier. */
  to: string;
  /** The period's last day as chosen, for labels. */
  nominalTo: string;
  /** 00:00 IST on `from`. */
  start: Date;
  /** 00:00 IST on the day after `to`, excluded. */
  end: Date;
  /** Days from `from` to `to`, both included. */
  days: number;
  /** True while the period runs past `to` (it is still going). */
  partial: boolean;
};

export type PeriodRefusal =
  | "invalid_period"
  | "invalid_range"
  | "period_in_future"
  | "range_too_long";

export type PeriodResult =
  | { ok: true; period: ResolvedPeriod }
  | { ok: false; reason: PeriodRefusal };

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumber(day: string): number | null {
  const match = DAY_PATTERN.exec(day);
  if (!match) return null;
  const [year, month, date] = [match[1], match[2], match[3]].map(Number) as [
    number,
    number,
    number,
  ];
  const ms = Date.UTC(year, month - 1, date);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  ) {
    return null;
  }
  return ms / DAY_MS;
}

function requireDayNumber(day: string): number {
  const number = dayNumber(day);
  if (number === null) {
    throw new RangeError(`Not a calendar day: ${JSON.stringify(day)}`);
  }
  return number;
}

function dayOfNumber(number: number): string {
  return new Date(number * DAY_MS).toISOString().slice(0, 10);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function lastDayOfMonth(year: number, month: number): string {
  return dayOfNumber(Date.UTC(year, month, 0) / DAY_MS);
}

/** Whether `day` is a real calendar day written `YYYY-MM-DD`. */
export function isCalendarDay(day: string): boolean {
  return dayNumber(day) !== null;
}

/** The calendar day `at` falls on in IST, as `YYYY-MM-DD`. */
export function istDateOf(at: Date): string {
  const ms = at.getTime();
  if (Number.isNaN(ms)) throw new RangeError("Invalid date");
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant 00:00 IST begins on `day`. */
export function istMidnight(day: string): Date {
  return new Date(requireDayNumber(day) * DAY_MS - IST_OFFSET_MS);
}

/** The day `count` days after `day` (before it when negative). */
export function addDays(day: string, count: number): string {
  return dayOfNumber(requireDayNumber(day) + count);
}

/** Days from `from` to `to`, both included. */
function daysBetween(from: string, to: string): number {
  return requireDayNumber(to) - requireDayNumber(from) + 1;
}

function isWholeIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** The first and last day of the chosen period, or null if impossible. */
function bounds(choice: PeriodChoice): { from: string; to: string } | null {
  switch (choice.kind) {
    case "month": {
      if (!isWholeIn(choice.year, FIRST_FY, LAST_FY)) return null;
      if (!isWholeIn(choice.month, 1, 12)) return null;
      return {
        from: `${pad(choice.year, 4)}-${pad(choice.month, 2)}-01`,
        to: lastDayOfMonth(choice.year, choice.month),
      };
    }
    case "quarter": {
      if (!isWholeIn(choice.fyStartYear, FIRST_FY, LAST_FY)) return null;
      if (!isWholeIn(choice.quarter, 1, 4)) return null;
      // Quarter 1 starts in April (month 4); quarter 4 in next January.
      const firstMonth = 4 + (choice.quarter - 1) * 3;
      const year = choice.fyStartYear + (firstMonth > 12 ? 1 : 0);
      const month = ((firstMonth - 1) % 12) + 1;
      return {
        from: `${pad(year, 4)}-${pad(month, 2)}-01`,
        to: lastDayOfMonth(year, month + 2),
      };
    }
    case "fy": {
      if (!isWholeIn(choice.fyStartYear, FIRST_FY, LAST_FY)) return null;
      return {
        from: `${pad(choice.fyStartYear, 4)}-04-01`,
        to: `${pad(choice.fyStartYear + 1, 4)}-03-31`,
      };
    }
    case "range":
      return { from: choice.from, to: choice.to };
  }
}

/** The period covering `from`..`nominalTo`, cut to at most `days` days. */
function cover(
  choice: PeriodChoice,
  from: string,
  nominalTo: string,
  days: number
): ResolvedPeriod {
  const nominalDays = daysBetween(from, nominalTo);
  const covered = Math.min(days, nominalDays);
  const to = addDays(from, covered - 1);
  return {
    choice,
    from,
    to,
    nominalTo,
    start: istMidnight(from),
    end: istMidnight(addDays(to, 1)),
    days: covered,
    partial: covered < nominalDays,
  };
}

/**
 * Places the chosen period against `now`: it covers days up to today (IST)
 * at most. Refuses an impossible period, a range ending before it starts,
 * a period starting after today and a range over MAX_RANGE_DAYS.
 */
export function resolvePeriod(choice: PeriodChoice, now: Date): PeriodResult {
  const span = bounds(choice);
  if (!span) return { ok: false, reason: "invalid_period" };
  const from = dayNumber(span.from);
  const to = dayNumber(span.to);
  if (from === null || to === null || to < from) {
    return { ok: false, reason: "invalid_range" };
  }
  if (choice.kind === "range" && to - from + 1 > MAX_RANGE_DAYS) {
    return { ok: false, reason: "range_too_long" };
  }
  const today = requireDayNumber(istDateOf(now));
  if (from > today) return { ok: false, reason: "period_in_future" };
  return {
    ok: true,
    period: cover(choice, span.from, span.to, today - from + 1),
  };
}

/** The period a report opens on: the financial year so far. */
export function defaultPeriod(now: Date): PeriodChoice {
  const [year, month] = istDateOf(now).split("-").map(Number) as [
    number,
    number,
  ];
  return { kind: "fy", fyStartYear: month >= 4 ? year : year - 1 };
}

function precedingChoice(period: ResolvedPeriod): PeriodChoice {
  const { choice } = period;
  switch (choice.kind) {
    case "month":
      return choice.month === 1
        ? { kind: "month", year: choice.year - 1, month: 12 }
        : { kind: "month", year: choice.year, month: choice.month - 1 };
    case "quarter":
      return choice.quarter === 1
        ? { kind: "quarter", fyStartYear: choice.fyStartYear - 1, quarter: 4 }
        : {
            kind: "quarter",
            fyStartYear: choice.fyStartYear,
            quarter: (choice.quarter - 1) as Quarter,
          };
    case "fy":
      return { kind: "fy", fyStartYear: choice.fyStartYear - 1 };
    case "range": {
      const length = daysBetween(period.from, period.nominalTo);
      return {
        kind: "range",
        from: addDays(period.from, -length),
        to: addDays(period.from, -1),
      };
    }
  }
}

/**
 * The period a report compares with: the one before, of the same kind,
 * covering as many days as `period` does (all of it when `period` is
 * complete). A custom range is compared with the equal run of days
 * straight before it.
 */
export function previousPeriod(period: ResolvedPeriod): ResolvedPeriod {
  const choice = precedingChoice(period);
  const span = bounds(choice);
  if (!span) throw new RangeError("No period before this one");
  return cover(choice, span.from, span.to, period.days);
}

const MONTH_PARAM = /^(\d{4})-(\d{2})$/;
const FY_PARAM = /^fy(\d{4})-(\d{2})(?:-q([1-4]))?$/;
const RANGE_PARAM = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;

function fyLabel(startYear: number): string {
  return `${pad(startYear, 4)}-${pad((startYear + 1) % 100, 2)}`;
}

/**
 * Reads a period from a URL search param: `2026-12` (month), `fy2026-27`
 * (financial year), `fy2026-27-q3` (quarter), `2026-10-01_2026-12-31`
 * (custom range). Returns null for anything else. Whether the period is
 * allowed (not in the future, not too long) is `resolvePeriod`'s call.
 */
export function parsePeriodParam(param: string): PeriodChoice | null {
  const month = MONTH_PARAM.exec(param);
  if (month) {
    const value = Number(month[2]);
    if (value < 1 || value > 12) return null;
    return { kind: "month", year: Number(month[1]), month: value };
  }
  const fy = FY_PARAM.exec(param);
  if (fy) {
    const startYear = Number(fy[1]);
    if (fyLabel(startYear) !== `${fy[1]}-${fy[2]}`) return null;
    if (fy[3] === undefined) return { kind: "fy", fyStartYear: startYear };
    return {
      kind: "quarter",
      fyStartYear: startYear,
      quarter: Number(fy[3]) as Quarter,
    };
  }
  const range = RANGE_PARAM.exec(param);
  if (range) {
    const [from, to] = [range[1]!, range[2]!];
    if (dayNumber(from) === null || dayNumber(to) === null) return null;
    return { kind: "range", from, to };
  }
  return null;
}

/** Writes a period as the search param `parsePeriodParam` reads. */
export function formatPeriodParam(choice: PeriodChoice): string {
  switch (choice.kind) {
    case "month":
      return `${pad(choice.year, 4)}-${pad(choice.month, 2)}`;
    case "quarter":
      return `fy${fyLabel(choice.fyStartYear)}-q${choice.quarter}`;
    case "fy":
      return `fy${fyLabel(choice.fyStartYear)}`;
    case "range":
      return `${choice.from}_${choice.to}`;
  }
}

export type Granularity = "week" | "month";

/** How a trend over `days` days is bucketed: by week up to 92 days. */
export function granularityFor(days: number): Granularity {
  return days <= 92 ? "week" : "month";
}

/** The day after the last day of the bucket `day` falls in. */
function nextBucketStart(day: string, granularity: Granularity): string {
  const number = requireDayNumber(day);
  if (granularity === "week") {
    // Day 0 (1 January 1970) was a Thursday, so Monday is 0 at (n + 3) mod
    // 7. Days before 1970 are negative, and `%` keeps the sign: add 7.
    const weekday = (((number + 3) % 7) + 7) % 7;
    return dayOfNumber(number + 7 - weekday);
  }
  const [year, month] = day.split("-").map(Number) as [number, number];
  return month === 12
    ? `${pad(year + 1, 4)}-01-01`
    : `${pad(year, 4)}-${pad(month + 1, 2)}-01`;
}

/**
 * The covered days of `period` as consecutive buckets: Monday-to-Sunday
 * weeks or calendar months, the first and last clipped to the period.
 */
export function splitPeriod(
  period: ResolvedPeriod,
  granularity: Granularity
): { from: string; to: string }[] {
  const buckets: { from: string; to: string }[] = [];
  let from = period.from;
  while (requireDayNumber(from) <= requireDayNumber(period.to)) {
    const next = nextBucketStart(from, granularity);
    const last = addDays(next, -1);
    const to =
      requireDayNumber(last) < requireDayNumber(period.to) ? last : period.to;
    buckets.push({ from, to });
    from = next;
  }
  return buckets;
}
