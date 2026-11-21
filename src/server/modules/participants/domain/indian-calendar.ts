// The calendar date in India (IST, UTC+05:30, no daylight saving) for an
// instant. Ages, Participant ID years and other date rules that people see
// use this calendar, not UTC's.
//
// Pure: no database, no clock of its own. Loads under plain Node.

/** A date on the calendar, with no time of day. `month` is 1-12. */
export type CalendarDate = { year: number; month: number; day: number };

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The calendar date in India at `instant`. */
export function indianDateAt(instant: Date): CalendarDate {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Negative if `a` is before `b`, 0 on the same day, positive after. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}
