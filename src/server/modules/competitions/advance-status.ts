// Moving a competition's status when its status job arrives (#71).
//
//   advanceCompetitionStatus({ competitionId, kind, dueAt })  → the worker only
//
// The job names the key date it was saved for and the instant that date
// held then. The use case locks the competition and asks planStatusJob
// what to do with it as it is now, then does that through the guards
// (./transition-guards.ts): each move it makes gets one audit entry by
// the system, naming the key date that made it, and a guarded move that
// can't be made yet is recorded as refused.
// Loads under plain Node (the worker): relative imports only.

import { z } from "zod";

import { authorize } from "../../access/can";
import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import { invalidInput, type InvalidInput } from "../../input";
import type { Clock } from "../../ports/clock";
import { KEY_DATE_KINDS, type KeyDateKind } from "./domain/key-dates";
import { planStatusJob } from "./domain/status-schedule";
import type { CompetitionStatus } from "./domain/vocabulary";
import {
  competitionResource,
  isCompetitionId,
  type CompetitionsContext,
} from "./manage";
import { saveStatusJobs } from "./status-jobs";
import { loadCompetition } from "./store";
import { makeScheduledMoves } from "./transition-guards";

const inputSchema = z.object({
  competitionId: z.string(),
  kind: z.enum(KEY_DATE_KINDS),
  dueAt: z.iso.datetime(),
});

export type AdvanceCompetitionStatusInput = {
  competitionId: string;
  kind: KeyDateKind;
  /** The instant the key date held when the job was saved (ISO). */
  dueAt: string;
};

export type AdvanceCompetitionStatusResult =
  | {
      ok: true;
      /**
       * `stale`: its date moved or went, so nothing happened. `early`: it
       * ran before its instant, so it was saved again for that instant.
       * `advanced`: every move due by now was made, as far as its guards
       * allow (perhaps none).
       */
      outcome: "stale" | "early" | "advanced";
      /** The competition's status once the job is done. */
      status: CompetitionStatus;
    }
  | { ok: false; error: "not_found" }
  | InvalidInput;

/** Runs one status job for the competition as it is now. */
export async function advanceCompetitionStatus(
  ctx: CompetitionsContext,
  input: AdvanceCompetitionStatusInput
): Promise<AdvanceCompetitionStatusResult> {
  await authorize(
    ctx,
    "competition.advance_status",
    competitionResource(input.competitionId)
  );
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, kind } = parsed.data;
  if (!isCompetitionId(competitionId)) {
    return { ok: false, error: "not_found" };
  }
  const job = { kind, dueAt: new Date(parsed.data.dueAt) };
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const stored = await loadCompetition(tx, competitionId, { lock: true });
    if (!stored) return { ok: false, error: "not_found" } as const;
    const { status } = stored.row;
    const plan = planStatusJob(
      job,
      { status, keyDates: stored.values.keyDates },
      now
    );
    if (plan.kind === "stale") {
      return { ok: true, outcome: "stale", status } as const;
    }
    if (plan.kind === "early") {
      await saveStatusJobs(tx, ctx.clock, competitionId, [
        { kind, dueAt: plan.dueAt },
      ]);
      return { ok: true, outcome: "early", status } as const;
    }
    const moved = await makeScheduledMoves(
      tx,
      ctx,
      { id: competitionId, status, disciplines: stored.values.disciplines },
      plan.transitions
    );
    return { ok: true, outcome: "advanced", status: moved } as const;
  });
}

/** The worker, as the status jobs run. */
const WORKER: Actor = { kind: "system", process: "worker" };

/**
 * The outbox handler for `competitions.key_date_scheduled`: the job, run
 * as the worker. A job for a competition that is gone does nothing.
 */
export async function runStatusJob(
  deps: { db: AppDb; clock: Clock },
  payload: AdvanceCompetitionStatusInput
): Promise<void> {
  const result = await advanceCompetitionStatus(
    { db: deps.db, clock: deps.clock, actor: WORKER },
    payload
  );
  if (!result.ok && result.error === "invalid_input") {
    throw new Error(
      `The status job for competition ${payload.competitionId} is not valid: ${result.fields.join(", ")}`
    );
  }
}
