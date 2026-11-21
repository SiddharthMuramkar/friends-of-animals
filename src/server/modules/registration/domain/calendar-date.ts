// Calendar dates for registration rules (#75): dates of birth, the
// competition's age cut-off and "today" in India. A calendar date has no
// time or zone, so no birthday ever shifts by a day because of UTC.
//
// Pure: no clock of its own. Loads under plain Node.

export type CalendarDate = { year: number; month: number; day: number };

/** IST is UTC+05:30 all year: India has no daylight saving. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True when the date exists on the calendar. */
export function isRealDate({ year, month, day }: CalendarDate): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

/** Negative when `a` is earlier, zero when equal, positive when later. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** The date in India at `instant`. */
export function indianDateAt(instant: Date): CalendarDate {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** `YYYY-MM-DD`, as Postgres `date` columns and date inputs spell it. */
export function formatIsoDate({ year, month, day }: CalendarDate): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reads `YYYY-MM-DD`; null for any other spelling or a date that doesn't exist. */
export function parseIsoDate(text: string): CalendarDate | null {
  const match = ISO_DATE.exec(text);
  if (!match) return null;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return isRealDate(date) ? date : null;
}

/**
 * Completed years of life on `on`. Someone born on 29 February has their
 * birthday on 1 March in other years, so they reach an age a day later
 * rather than a day early: the safer side for rules about minors.
 * Negative for someone born after `on`.
 */
export function completedYearsOn(
  birth: CalendarDate,
  on: CalendarDate
): number {
  const leapling = birth.month === 2 && birth.day === 29;
  const birthday =
    leapling && !isLeapYear(on.year)
      ? { year: on.year, month: 3, day: 1 }
      : { year: on.year, month: birth.month, day: birth.day };
  const years = on.year - birth.year;
  return compareDates(on, birthday) < 0 ? years - 1 : years;
}
