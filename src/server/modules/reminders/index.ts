// The reminders module (#84): named reminders before a deadline, sent to
// whoever still owes it when each one runs. The registry (./registry.ts)
// lists them; the worker schedules them (./schedule-reminders.ts), syncs
// them hourly (./schedule.ts) and runs each at its time
// (./run-reminder.ts). Its use cases join `as(actor)` through
// `remindersUseCases`; only the platform may call them.

import type { UseCaseContext } from "../../use-cases";
import { runReminder } from "./run-reminder";
import {
  scheduleReminders,
  syncReminders,
  type ScheduleRemindersInput,
} from "./schedule-reminders";

export type { RunReminderResult } from "./run-reminder";
export type {
  ScheduleRemindersInput,
  ScheduleRemindersResult,
  SyncRemindersResult,
} from "./schedule-reminders";
export { REMINDERS, type ReminderDefinition } from "./registry";
export { REMINDERS_POLICY, type RemindersAction } from "./policy";

export const remindersUseCases = (ctx: UseCaseContext) => ({
  scheduleReminders: (input: ScheduleRemindersInput) =>
    scheduleReminders(ctx, input),
  syncReminders: () => syncReminders(ctx),
  runReminder: (input: { reminderJobId: string }) => runReminder(ctx, input),
});
