// When reminders fire: a list of whole hours before a deadline, kept in
// runtime settings per named reminder (#84: "Reminder timing lives in
// runtime settings"). The spec gives no default; 72 h and 24 h is the
// proposed one, for FOA to confirm.

import { z } from "zod";

export const DEFAULT_REMINDER_OFFSETS_HOURS: readonly number[] = [72, 24];

const MAX_OFFSET_HOURS = 30 * 24;
const MAX_OFFSETS = 5;
const HOUR_MS = 60 * 60 * 1000;

/** A settings value: up to five distinct whole hours, 1 h to 30 days. */
export const reminderOffsetsSchema = z
  .array(z.int().min(1).max(MAX_OFFSET_HOURS))
  .max(MAX_OFFSETS)
  .refine(
    (offsets) => new Set(offsets).size === offsets.length,
    "reminder_offsets_repeated"
  )
  .transform((offsets) => offsets.toSorted((a, b) => b - a));

export type PlannedReminder = { offsetHours: number; fireAt: Date };

/**
 * The reminders still to send for a deadline, soonest first. An offset
 * whose time has already gone is skipped rather than sent late, so
 * publishing or moving a deadline close to it never sends a burst; one due
 * exactly now is kept. No deadline, or one already passed, plans nothing.
 */
export function planReminderTimes({
  deadlineAt,
  offsetsHours,
  now,
}: {
  deadlineAt: Date | null;
  offsetsHours: readonly number[];
  now: Date;
}): PlannedReminder[] {
  if (deadlineAt === null || deadlineAt.getTime() <= now.getTime()) return [];
  return offsetsHours
    .map((offsetHours) => ({
      offsetHours,
      fireAt: new Date(deadlineAt.getTime() - offsetHours * HOUR_MS),
    }))
    .filter((reminder) => reminder.fireAt.getTime() >= now.getTime())
    .toSorted((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}
