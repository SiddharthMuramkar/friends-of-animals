// Age rules for people registering themselves. We store the date of birth,
// never an age: the age is worked out when it is needed, from the injected
// clock's instant, on the Indian calendar (IST, UTC+05:30, no daylight
// saving), because that is the date the person and FOA see. The calendar
// arithmetic is the registration module's (#75), so both routes count a
// birthday the same way.
//
// Pure: no database, no clock of its own. Loads under plain Node.

import {
  compareDates,
  completedYearsOn,
  indianDateAt,
  parseIsoDate,
  type CalendarDate,
} from "../../registration/domain/calendar-date";

export type { CalendarDate } from "../../registration/domain/calendar-date";

/** The age from which someone may register themselves. */
export const ADULT_AGE = 18;

/** Dates of birth before this are treated as typing mistakes. */
const EARLIEST_BIRTH: CalendarDate = { year: 1900, month: 1, day: 1 };

/**
 * Completed years of life at `at`, on the Indian calendar. Someone born on
 * 29 February has their birthday on 1 March in other years, so they reach
 * an age a day later rather than a day early: the safer side for an age
 * limit that protects minors.
 */
export function ageAt(dateOfBirth: CalendarDate, at: Date): number {
  return completedYearsOn(dateOfBirth, indianDateAt(at));
}

/** True from the 18th birthday, on the Indian calendar. */
export function isAdultAt(dateOfBirth: CalendarDate, at: Date): boolean {
  return ageAt(dateOfBirth, at) >= ADULT_AGE;
}

/**
 * Reads a date of birth typed as `YYYY-MM-DD` (what `<input type="date">`
 * submits). Returns null for any other spelling, a date that does not
 * exist, a date after today in India, or one before 1900. Day-first
 * spellings are refused rather than guessed.
 */
export function parseDateOfBirth(text: string, at: Date): CalendarDate | null {
  const date = parseIsoDate(text);
  if (!date) return null;
  if (compareDates(date, EARLIEST_BIRTH) < 0) return null;
  if (compareDates(date, indianDateAt(at)) > 0) return null;
  return date;
}
