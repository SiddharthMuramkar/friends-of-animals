// When a requested artwork must be dispatched by, and when the reminder
// goes out (#93). Deadlines close at the end of an IST calendar day, so the
// sender reads "by 29 January" rather than a time of day. India has one
// time zone and no daylight saving, so a fixed offset is exact.
//
// Loads under plain Node: no "server-only", no `@/` imports.

/** Bounds of the `artwork.dispatchDays` setting. */
export const DISPATCH_DAYS = { default: 14, min: 3, max: 60 } as const;

/** Bounds of the `artwork.dispatchReminderLeadHours` setting. */
export const DISPATCH_REMINDER_LEAD_HOURS = {
  default: 72,
  min: 1,
  max: 336,
} as const;

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;
/** India Standard Time is UTC+05:30. */
const IST_OFFSET_MS = 5.5 * HOUR_MS;

function assertWithin(
  name: string,
  value: number,
  bounds: { min: number; max: number }
): void {
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new RangeError(
      `${name} must be a whole number from ${bounds.min} to ${bounds.max}, got ${value}`
    );
  }
}

/**
 * 23:59:59 IST on the day `dispatchDays` after the IST date of the
 * request. Throws on a value the settings registry never produces.
 */
export function dispatchDeadline(
  requestedAt: Date,
  dispatchDays: number
): Date {
  assertWithin("Dispatch days", dispatchDays, DISPATCH_DAYS);
  const istMidnight =
    Math.floor((requestedAt.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(
    istMidnight + (dispatchDays + 1) * DAY_MS - SECOND_MS - IST_OFFSET_MS
  );
}

/**
 * When to remind the sender: `leadHours` before the deadline, or null when
 * that is not after the request, because the request message itself is
 * the reminder then.
 */
export function dispatchReminderAt({
  requestedAt,
  deadline,
  leadHours,
}: {
  requestedAt: Date;
  deadline: Date;
  leadHours: number;
}): Date | null {
  assertWithin("Reminder lead hours", leadHours, DISPATCH_REMINDER_LEAD_HOURS);
  const at = deadline.getTime() - leadHours * HOUR_MS;
  return at > requestedAt.getTime() ? new Date(at) : null;
}
