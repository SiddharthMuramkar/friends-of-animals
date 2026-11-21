// Registers the SCHEDULES registry (src/server/outbox/schedules.ts) with
// pg-boss, in single-database mode only: production, staging and a local
// run. The shared preview worker runs none, since nightly copies and
// purges mean nothing on a preview, and a `pgboss` schema in every preview
// database would need DDL rights there. Something due once is an outbox
// event with `availableAt`, which previews do run.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  scheduleProblems,
  type OutboxDeps,
  type ScheduleDefinition,
} from "../server/outbox";

/** The pg-boss calls this uses; a started `PgBoss` instance fits. */
export type ScheduleBoss = {
  getSchedules(): Promise<{ name: string; key: string }[]>;
  unschedule(name: string): Promise<void>;
  createQueue(name: string): Promise<void>;
  schedule(
    name: string,
    cron: string,
    data: object | null,
    options: { tz: string }
  ): Promise<void>;
  work(
    name: string,
    handler: (jobs: unknown[]) => Promise<unknown>
  ): Promise<string>;
};

/**
 * Makes pg-boss run exactly `schedules`: removes the crons of schedules the
 * code no longer declares, then, per schedule, creates its queue (a no-op
 * if it exists), stores its cron in its zone and starts a worker that runs
 * it against `deps`. A failed run fails the job, which pg-boss retries.
 * Throws, registering nothing, if the registry is invalid.
 */
export async function registerSchedules(
  boss: ScheduleBoss,
  schedules: readonly ScheduleDefinition[],
  deps: OutboxDeps
): Promise<void> {
  const problems = scheduleProblems(schedules);
  if (problems.length > 0) {
    throw new Error(`SCHEDULES can't be registered:\n${problems.join("\n")}`);
  }
  const declared = new Set(schedules.map((schedule) => schedule.name));
  for (const { name } of await boss.getSchedules()) {
    if (!declared.has(name)) await boss.unschedule(name);
  }
  for (const schedule of schedules) {
    await boss.createQueue(schedule.name);
    await boss.schedule(schedule.name, schedule.cron, null, {
      tz: schedule.tz,
    });
    await boss.work(schedule.name, () => schedule.run(deps));
  }
}
