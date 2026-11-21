// Age rules for people registering themselves. We store the date of birth,
// never an age: the age is worked out when it is needed, from the injected
// clock's instant, on the Indian calendar (IST, UTC+05:30, no daylight
// saving), because that is the date the person and FOA see.
//
// Pure: no database, no clock of its own. Loads under plain Node.

import {
  type CalendarDate,
  compareDates,
  indianDateAt,
} from "./indian-calendar";

export type { CalendarDate } from "./indian-calendar";

/** The age from which someone may register themselves. */
export const ADULT_AGE = 18;

/** Dates of birth before this are treated as typing mistakes. */
const EARLIEST_BIRTH: CalendarDate = { year: 1900, month: 1, day: 1 };

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Completed years of life at `at`, on the Indian calendar. Someone born on
 * 29 February has their birthday on 1 March in other years, so they reach
 * an age a day later rather than a day early: the safer side for an age
 * limit that protects minors.
 */
export function ageAt(dateOfBirth: CalendarDate, at: Date): number {
  const today = indianDateAt(at);
  const leapling = dateOfBirth.month === 2 && dateOfBirth.day === 29;
  const birthday =
    leapling && !isLeapYear(today.year)
      ? { year: today.year, month: 3, day: 1 }
      : { year: today.year, month: dateOfBirth.month, day: dateOfBirth.day };
  const years = today.year - dateOfBirth.year;
  return compareDates(today, birthday) < 0 ? years - 1 : years;
}

/** True from the 18th birthday, on the Indian calendar. */
export function isAdultAt(dateOfBirth: CalendarDate, at: Date): boolean {
  return ageAt(dateOfBirth, at) >= ADULT_AGE;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Reads a date of birth typed as `YYYY-MM-DD` (what `<input type="date">`
 * submits). Returns null for any other spelling, a date that does not
 * exist, a date after today in India, or one before 1900. Day-first
 * spellings are refused rather than guessed.
 */
export function parseDateOfBirth(text: string, at: Date): CalendarDate | null {
  const match = ISO_DATE.exec(text);
  if (!match) return null;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (date.month < 1 || date.month > 12) return null;
  if (date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
    return null;
  }
  if (compareDates(date, EARLIEST_BIRTH) < 0) return null;
  if (compareDates(date, indianDateAt(at)) > 0) return null;
  return date;
}
