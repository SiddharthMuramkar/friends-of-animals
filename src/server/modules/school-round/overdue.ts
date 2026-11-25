// Overdue school rounds (#90). At the shortlist deadline (the
// competition's `school_round_closes` key date) every round still open
// becomes overdue, by the system. Nothing finalises it: the school can
// still finalise it, or a competition manager closes it on the school's
// behalf. Each overdue round's coordinators are told
// (`school_round.overdue`, by route row).
//
// Two callers:
// - the outbox handler school_round.mark_overdue, on the same
//   `competitions.key_date_scheduled` job that moves the competition's
//   status. The job carries the instant it was saved for, so a job left
//   over from a deadline that has since moved does nothing, and one that
//   runs early is saved again for its instant (../domain/deadline.ts);
// - opening the rounds (./open-school-rounds.ts): a competition that
//   entered school judging only after its deadline (its rubrics came
//   late) opens its rounds overdue at once.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, inArray } from "drizzle-orm";
import { createFormatter } from "next-intl";

import { formats, LOCALE, TIME_ZONE } from "../../../i18n/formats";
import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionKeyDate,
  institution,
  institutionRegistration,
  schoolRound,
} from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { Clock } from "../../ports/clock";
import { retryBlockedMoves } from "../competitions/advance-status";
import { planRoundDeadlineJob } from "./domain/deadline";
import { recordRoundTransition } from "./store";

const WORKER: Actor = { kind: "system", process: "worker" };

/** The competition's shortlist deadline as it is now, if it has one. */
export async function shortlistDeadlineOf(
  db: AppDb,
  competitionId: string
): Promise<Date | null> {
  const [row] = await db
    .select({ at: competitionKeyDate.at })
    .from(competitionKeyDate)
    .where(
      and(
        eq(competitionKeyDate.competitionId, competitionId),
        eq(competitionKeyDate.kind, "school_round_closes")
      )
    );
  return row?.at ?? null;
}

/**
 * Moves the competition's open rounds to overdue, inside the caller's
 * transaction (the competition held), and tells each round's
 * coordinators. Returns how many it moved.
 */
export async function markRoundsOverdue(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  competitionId: string
): Promise<number> {
  const open = await tx
    .select({
      id: schoolRound.id,
      institutionRegistrationId: schoolRound.institutionRegistrationId,
    })
    .from(schoolRound)
    .where(
      and(
        eq(schoolRound.competitionId, competitionId),
        eq(schoolRound.status, "open")
      )
    )
    .orderBy(schoolRound.id)
    .for("update");
  if (open.length === 0) return 0;
  const now = ctx.clock.now();
  await tx
    .update(schoolRound)
    .set({ status: "overdue", updatedAt: now })
    .where(
      inArray(
        schoolRound.id,
        open.map((round) => round.id)
      )
    );
  for (const round of open) {
    await recordRoundTransition(tx, ctx, {
      roundId: round.id,
      from: "open",
      to: "overdue",
    });
    await emit(tx, ctx.clock, {
      type: "school_round.overdue",
      aggregate: { type: "school_round", id: round.id },
      payload: {
        roundId: round.id,
        competitionId,
        institutionRegistrationId: round.institutionRegistrationId,
      },
    });
  }
  return open.length;
}

/**
 * The outbox handler school_round.mark_overdue, for every status job: only
 * the shortlist deadline's job does anything.
 */
export async function runRoundDeadlineJob(
  deps: { db: AppDb; clock: Clock },
  payload: { competitionId: string; kind: string; dueAt: string }
): Promise<void> {
  if (payload.kind !== "school_round_closes") return;
  const job = { dueAt: new Date(payload.dueAt) };
  const marked = await deps.db.transaction(async (tx) => {
    const [held] = await tx
      .select({ status: competition.status })
      .from(competition)
      .where(eq(competition.id, payload.competitionId))
      .for("share");
    if (!held) return 0;
    const plan = planRoundDeadlineJob(
      job,
      {
        deadline: await shortlistDeadlineOf(tx, payload.competitionId),
        inSchoolJudging: held.status === "school_judging",
        rounds: [],
      },
      deps.clock.now()
    );
    // Stale, or not in school judging. An early run needs nothing here:
    // the competition's own status job (the same event) saves the job
    // again for its instant, which runs this handler again too.
    if (plan.kind !== "mark_overdue") return 0;
    return markRoundsOverdue(
      tx,
      { clock: deps.clock, actor: WORKER },
      payload.competitionId
    );
  });
  // The status job may have refused the move to FOA judging first: its
  // refusal then counts these rounds as overdue, not open.
  if (marked > 0) {
    await retryBlockedMoves(deps, { competitionId: payload.competitionId });
  }
}

/** The variables the overdue notice may use, beyond the recipient's. */
export const SCHOOL_ROUND_OVERDUE_VARIABLES = [
  "competition.name",
  "institution.name",
  "round.deadline",
] as const;

const format = createFormatter({
  locale: LOCALE,
  formats,
  timeZone: TIME_ZONE,
});

/** The overdue notice's values for one round. */
export async function overdueValues(
  db: AppDb,
  roundId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      competitionId: competition.id,
      competitionName: competition.name,
      institutionName: institution.name,
    })
    .from(schoolRound)
    .innerJoin(competition, eq(competition.id, schoolRound.competitionId))
    .innerJoin(
      institutionRegistration,
      eq(institutionRegistration.id, schoolRound.institutionRegistrationId)
    )
    .innerJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .where(eq(schoolRound.id, roundId));
  if (!row) return {};
  const deadline = await shortlistDeadlineOf(db, row.competitionId);
  return {
    "competition.name": row.competitionName,
    "institution.name": row.institutionName,
    "round.deadline": deadline ? format.dateTime(deadline, "longDateTime") : "",
  };
}
