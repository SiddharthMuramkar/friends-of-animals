// The hourly reminder sync in the worker (#84; SCHEDULES in
// src/server/outbox/schedules.ts). At five past every hour (IST) it brings
// every live subject's reminders in step with its deadline and the offset
// settings: a changed setting plans its new reminders within the hour, a
// competition published before reminders existed gets its own, and a
// missed `reminders.schedule` delivery is made good. Each reminder still
// runs from its own delayed `reminder.due` event, on time. pg-boss retries
// a run that throws; only the final attempt reports to Sentry.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import type { Actor } from "../../actor";
import type { ScheduleDefinition } from "../../outbox/schedules";
import { syncReminders } from "./schedule-reminders";

export const REMINDERS_SYNC_JOB = "reminders.sync";

const WORKER: Actor = { kind: "system", process: "worker" };

export const remindersSyncSchedule: ScheduleDefinition = {
  name: REMINDERS_SYNC_JOB,
  cron: "5 * * * *",
  tz: "Asia/Kolkata",
  retryLimit: 2,
  retryDelay: 5 * 60,
  expireInSeconds: 15 * 60,
  async run(deps, job) {
    try {
      await syncReminders({
        db: deps.db,
        clock: deps.clock,
        settings: deps.settings,
        actor: WORKER,
      });
    } catch (error) {
      // Without `job` (a manual run) the attempt counts as the final one.
      if (job?.finalAttempt ?? true) {
        deps.errors.report(error, {
          where: REMINDERS_SYNC_JOB,
          tags: { job: REMINDERS_SYNC_JOB },
        });
      }
      throw error;
    }
  },
};
