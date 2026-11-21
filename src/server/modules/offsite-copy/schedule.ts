// The nightly schedule that runs the off-site copy in the worker (61b
// registers SCHEDULES with pg-boss). pg-boss owns the retries: a run that
// throws is tried again, and only the final attempt reports to Sentry.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import type { CopyBucket } from "../../ports/copy-bucket";
import { s3CopyBucket, type S3BucketConfig } from "../../ports/copy-bucket-s3";
import type {
  ScheduleDefinition,
  ScheduleDeps,
  ScheduleJob,
} from "../../outbox/schedules";
import { readOffsiteSettings } from "./config";
import { OffsiteCopyNotConfiguredError } from "./errors";
import { OFFSITE_COPY_JOB, runOffsiteCopy } from "./run-copy";

type Connect = (settings: { r2: S3BucketConfig; b2: S3BucketConfig }) => {
  source: CopyBucket;
  target: CopyBucket;
};

/** R2 and B2 through the S3 API. */
const connectS3: Connect = ({ r2, b2 }) => ({
  source: s3CopyBucket(r2),
  target: s3CopyBucket(b2),
});

/**
 * One scheduled run: nothing outside production; in production, the copy
 * with the buckets `env` names, or a failure naming each missing setting.
 * Without `job` (pg-boss gave no attempt details) the attempt counts as
 * the final one, so a failure is reported rather than lost.
 */
export async function runScheduledOffsiteCopy(
  deps: ScheduleDeps,
  job: ScheduleJob | undefined,
  {
    env,
    connect = connectS3,
  }: { env: Record<string, string | undefined>; connect?: Connect }
): Promise<void> {
  const attempt = { finalAttempt: job?.finalAttempt ?? true };
  const settings = readOffsiteSettings(env);
  if (settings.kind === "not_production") return;
  if (settings.kind === "invalid") {
    const error = new OffsiteCopyNotConfiguredError(settings.problems);
    if (attempt.finalAttempt) {
      deps.errors.report(error, {
        where: OFFSITE_COPY_JOB,
        tags: { job: OFFSITE_COPY_JOB },
        extra: { problems: settings.problems },
      });
    }
    throw error;
  }
  await runOffsiteCopy(
    {
      db: deps.db,
      clock: deps.clock,
      errors: deps.errors,
      ...connect({ r2: settings.r2, b2: settings.b2 }),
      config: settings.config,
    },
    attempt
  );
}

export const offsiteCopySchedule: ScheduleDefinition = {
  name: OFFSITE_COPY_JOB,
  // 01:30 IST: an hour before pgBackRest's 02:30 backup.
  cron: "30 1 * * *",
  tz: "Asia/Kolkata",
  // Three retries, 15 minutes apart at first, then further apart (backoff).
  retryLimit: 3,
  retryDelay: 15 * 60,
  retryBackoff: true,
  // The copy stops starting new objects after two hours (RUN_BUDGET_MS).
  expireInSeconds: 3 * 60 * 60,
  run: (deps, job) => runScheduledOffsiteCopy(deps, job, { env: process.env }),
};
