// Scheduled jobs: status flips, reminders, retention, nightly copies (#55).
// The VPS worker registers each one as a pg-boss schedule in
// single-database mode (#61's worker runtime); previews run none, and a
// Seam 1 test calls `run(h.deps)` itself after moving the clock. Work that
// follows one change goes through the outbox instead (./emit.ts), with
// `availableAt` when it must wait.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import { offsiteCopySchedule } from "../modules/offsite-copy/schedule";
import { reconcileLedgerSchedule } from "../modules/ledger/backfill";
import { retentionSweepSchedule } from "../modules/privacy/schedule";
import { expireDonationsSchedule } from "../modules/donations/expire";
import { flagOverdueSchedule } from "../modules/privacy/requests/overdue";
import { remindersSyncSchedule } from "../modules/reminders/schedule";
import type { ErrorReporter } from "../ports/errors";
import type { OutboxDeps } from "./handlers";

/** What a scheduled run gets: the relay's deps plus error reporting. */
export type ScheduleDeps = OutboxDeps & { errors: ErrorReporter };

/** What pg-boss says about this attempt at a run. */
export type ScheduleJob = {
  /** No retry follows if this attempt fails: report the failure now. */
  finalAttempt: boolean;
};

export type ScheduleDefinition = {
  /** Also the pg-boss queue name: lower case, digits, "_" and "." only. */
  name: string;
  /** Five fields: minute, hour, day of month, month, day of week. */
  cron: string;
  /** The zone `cron` is read in. */
  tz: "Asia/Kolkata" | "UTC";
  // How pg-boss retries a run that throws, under pg-boss's own option
  // names, so the worker passes them on unchanged. Unset: pg-boss's default.
  /** Attempts after the first. */
  retryLimit?: number;
  /** Seconds before the first retry. */
  retryDelay?: number;
  /** Double the delay before each later retry. */
  retryBackoff?: boolean;
  /** pg-boss fails an attempt still running after this long. */
  expireInSeconds?: number;
  /** `job` is absent when the caller can't tell (a test, a manual run). */
  run(deps: ScheduleDeps, job?: ScheduleJob): Promise<void>;
};

export const SCHEDULES: readonly ScheduleDefinition[] = [
  offsiteCopySchedule,
  reconcileLedgerSchedule,
  retentionSweepSchedule,
  expireDonationsSchedule,
  flagOverdueSchedule,
  remindersSyncSchedule,
];

const NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** What would stop the worker registering `schedules`; empty when fine. */
export function scheduleProblems(
  schedules: readonly ScheduleDefinition[]
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { name, cron } of schedules) {
    if (!NAME.test(name)) {
      problems.push(
        `"${name}" is not a schedule name (lower case, digits, "_" and "." only)`
      );
    }
    if (seen.has(name)) problems.push(`${name} is declared more than once`);
    seen.add(name);
    if (cron.trim().split(/\s+/).length !== 5) {
      problems.push(`${name} has a cron that isn't five fields: "${cron}"`);
    }
  }
  return problems;
}
