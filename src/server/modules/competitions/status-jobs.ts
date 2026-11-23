// Saving status jobs (#71). A status job is one
// `competitions.key_date_scheduled` event, available at its key date's
// instant: publishing saves one per key date, an edit one per date it adds
// or moves (domain/status-schedule.ts decides which). Pass the transaction
// that saves the change, so a job exists if and only if the change does.
// A job is never cancelled: one whose date has since moved finds itself
// stale when it runs and does nothing.
//
// Loads under plain Node (the worker): relative imports only.

import type { AppDb } from "../../db/app-db";
import { emit } from "../../outbox/emit";
import type { EventOf } from "../../outbox/events";
import type { Clock } from "../../ports/clock";
import type { StatusJob } from "./domain/status-schedule";

/** The event that carries `job` for one competition. */
export function keyDateScheduled(
  competitionId: string,
  job: StatusJob
): EventOf<"competitions.key_date_scheduled"> {
  return {
    type: "competitions.key_date_scheduled",
    aggregate: { type: "competition", id: competitionId },
    payload: {
      competitionId,
      kind: job.kind,
      dueAt: job.dueAt.toISOString(),
    },
  };
}

/** Saves each job, to run once its instant has come. */
export async function saveStatusJobs(
  tx: AppDb,
  clock: Clock,
  competitionId: string,
  jobs: readonly StatusJob[]
): Promise<void> {
  for (const job of jobs) {
    await emit(tx, clock, keyDateScheduled(competitionId, job), {
      availableAt: job.dueAt,
    });
  }
}
