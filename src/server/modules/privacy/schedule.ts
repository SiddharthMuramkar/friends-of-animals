// The daily retention sweep in the worker (#114; 61b registers SCHEDULES
// with pg-boss). It runs as the worker at 02:15 IST, after the 01:30
// off-site copy and before the 02:30 backup. pg-boss retries a run that
// throws; only the final attempt reports to Sentry. A run that stops
// part-way keeps what it did: each batch commits on its own, and the next
// run picks up the rest. Each committed batch also saves its counts for
// the audit, even if an attempt stops before it can write the audit row.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import type { Actor } from "../../actor";
import type { ScheduleDefinition } from "../../outbox/schedules";
import { runRetentionSweep, SWEEP_EXPIRY_SECONDS } from "./sweep";

export const RETENTION_SWEEP_JOB = "privacy.retention_sweep";

const WORKER: Actor = { kind: "system", process: "worker" };

export const retentionSweepSchedule: ScheduleDefinition = {
  name: RETENTION_SWEEP_JOB,
  cron: "15 2 * * *",
  tz: "Asia/Kolkata",
  retryLimit: 2,
  retryDelay: 15 * 60,
  retryBackoff: true,
  expireInSeconds: SWEEP_EXPIRY_SECONDS,
  async run(deps, job) {
    try {
      await runRetentionSweep({
        db: deps.db,
        clock: deps.clock,
        settings: deps.settings,
        storage: deps.storage,
        blindIndex: deps.blindIndex,
        cipher: deps.cipher,
        actor: WORKER,
      });
    } catch (error) {
      // Without `job` (a manual run) the attempt counts as the final one.
      if (job?.finalAttempt ?? true) {
        deps.errors.report(error, {
          where: RETENTION_SWEEP_JOB,
          tags: { job: RETENTION_SWEEP_JOB },
        });
      }
      throw error;
    }
  },
};
