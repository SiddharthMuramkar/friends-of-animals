// Whether a participant is a minor at a given instant. Messages about a
// minor go to their guardian, never to the minor, so every doubtful case
// (no date of birth, a 29 February birthday in a common year) counts as a
// minor. Dates of birth are calendar dates in India; the instant is read on
// the IST calendar (UTC+05:30, no daylight saving).

/** A calendar date, `YYYY-MM-DD`, as a date of birth is stored. */
export type IsoDate = string;

const ADULT_AGE = 18;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type CalendarDate = { year: number; month: number; day: number };

function parseIsoDate(value: IsoDate): CalendarDate {
  const match = ISO_DATE.exec(value);
  if (match) {
    const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [
      number,
      number,
      number,
    ];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return { year, month, day };
    }
  }
  throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${value}`);
}

function istCalendarDate(at: Date): CalendarDate {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * True unless the person's 18th birthday has arrived on the IST calendar at
 * `at`. Someone born on 29 February becomes an adult on 1 March in a common
 * year. An unknown date of birth (`null`) counts as a minor.
 */
export function isUnder18On(dateOfBirth: IsoDate | null, at: Date): boolean {
  if (dateOfBirth === null) return true;
  const born = parseIsoDate(dateOfBirth);
  const today = istCalendarDate(at);
  const comingOfAgeYear = born.year + ADULT_AGE;
  if (today.year !== comingOfAgeYear) return today.year < comingOfAgeYear;
  if (today.month !== born.month) return today.month < born.month;
  return today.day < born.day;
}
