// Who may run the reminders use cases (#84). Only the platform: the worker
// schedules reminders after a competition changes, syncs them every hour
// and runs each one at its time; the seed schedules the seeded
// competitions' reminders. No person schedules or sends a reminder by hand.
//
// Loads under plain Node: relative imports only.

import { system, type Policy } from "../../access/domain/policy";

export const REMINDERS_POLICY = {
  /** Planning a subject's reminders from its deadline and the settings. */
  "reminder.schedule": system("worker", "seed"),
  /** Running one reminder at its time. */
  "reminder.run": system("worker"),
} satisfies Policy<string>;

export type RemindersAction = keyof typeof REMINDERS_POLICY;
