// Recurring jobs: purges, reminders sweeps, reports. The VPS worker
// registers each one as a pg-boss schedule in single-database mode (#61's
// worker runtime); previews run none. Empty until a ticket adds one.
// Something to do once, for one record, is an event with `availableAt`
// instead (./emit.ts), so it also runs on previews and under the fake
// clock.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { OutboxDeps } from "./handlers";

export type ScheduleDefinition = {
  /** Also the pg-boss queue name: lower case, digits, "_" and "." only. */
  name: string;
  /** Five fields: minute, hour, day of month, month, day of week. */
  cron: string;
  /** The zone `cron` is read in. */
  tz: "Asia/Kolkata" | "UTC";
  run(deps: OutboxDeps): Promise<void>;
};

export const SCHEDULES: readonly ScheduleDefinition[] = [];

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
