// When reminders fire (#84: "Reminder timing lives in runtime settings").
// Each reminder reads one or more whole-number settings, each the hours
// before the deadline one reminder goes out at, with 0 turning that one
// off. The defaults (72 h and 24 h for submissions) wait for FOA (HR-37).
//
// Pure: no I/O, no "server-only".

/** The furthest a reminder may go out before its deadline: 30 days. */
export const MAX_REMINDER_OFFSET_HOURS = 30 * 24;

const isOffset = (hours: number) =>
  Number.isInteger(hours) && hours >= 1 && hours <= MAX_REMINDER_OFFSET_HOURS;

/**
 * The hours before a deadline a reminder's settings ask for: each one
 * once, furthest first. A setting at 0 is off; anything a setting can't
 * hold is ignored.
 */
export function reminderOffsets(values: readonly number[]): number[] {
  return [...new Set(values.filter(isOffset))].toSorted((a, b) => b - a);
}
