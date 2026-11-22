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
  type ScheduleDefinition,
  type ScheduleDeps,
} from "../server/outbox";

/** What pg-boss stores with a schedule: its zone, and each job's retries. */
export type ScheduleBossOptions = {
  tz: string;
} & Pick<
  ScheduleDefinition,
  "retryLimit" | "retryDelay" | "retryBackoff" | "expireInSeconds"
>;

/** The attempt details of a job fetched with `includeMetadata`. */
export type ScheduleBossJob = { retryCount: number; retryLimit: number };

/** The pg-boss calls this uses; a started `PgBoss` instance fits. */
export type ScheduleBoss = {
  getSchedules(): Promise<{ name: string; key: string }[]>;
  unschedule(name: string): Promise<void>;
  createQueue(name: string): Promise<void>;
  schedule(
    name: string,
    cron: string,
    data: object | null,
    options: ScheduleBossOptions
  ): Promise<void>;
  work(
    name: string,
    options: { includeMetadata: true },
    handler: (jobs: ScheduleBossJob[]) => Promise<unknown>
  ): Promise<string>;
};

/** The schedule's options as pg-boss names them, leaving out unset ones. */
function bossOptions(schedule: ScheduleDefinition): ScheduleBossOptions {
  const options: ScheduleBossOptions = { tz: schedule.tz };
  if (schedule.retryLimit !== undefined) {
    options.retryLimit = schedule.retryLimit;
  }
  if (schedule.retryDelay !== undefined) {
    options.retryDelay = schedule.retryDelay;
  }
  if (schedule.retryBackoff !== undefined) {
    options.retryBackoff = schedule.retryBackoff;
  }
  if (schedule.expireInSeconds !== undefined) {
    options.expireInSeconds = schedule.expireInSeconds;
  }
  return options;
}

/**
 * Makes pg-boss run exactly `schedules`: removes the crons of schedules the
 * code no longer declares, then, per schedule, creates its queue (a no-op
 * if it exists), stores its cron in its zone with its retries and time
 * limit, and starts a worker that runs it against `deps`. A failed run
 * fails the job, which pg-boss retries; the run learns whether this attempt
 * is the last. Throws, registering nothing, if the registry is invalid.
 */
export async function registerSchedules(
  boss: ScheduleBoss,
  schedules: readonly ScheduleDefinition[],
  deps: ScheduleDeps
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
    await boss.schedule(
      schedule.name,
      schedule.cron,
      null,
      bossOptions(schedule)
    );
    await boss.work(schedule.name, { includeMetadata: true }, ([job]) =>
      schedule.run(
        deps,
        // pg-boss counts retries from 0, so retryLimit retries means the
        // attempt with retryCount === retryLimit is the last.
        job ? { finalAttempt: job.retryCount >= job.retryLimit } : undefined
      )
    );
  }
}
