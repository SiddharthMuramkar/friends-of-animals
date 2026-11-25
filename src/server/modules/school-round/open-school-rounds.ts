// Opening a competition's school rounds (#89), by the outbox handler
// school_round.open_rounds after competition.school_judging_started: one
// open round per confirmed institution registration, that is an active one
// with at least one confirmed student, even if none of them submitted. The
// round exists for schools that never visit and for the overdue job (#90),
// which also runs here when the shortlist deadline has already passed.
// Running again adds nothing: the round's registration is unique.
//
// Loads under plain Node (the worker): relative imports only.

import { eq } from "drizzle-orm";

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import { competition, schoolRound } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import {
  confirmedRegistrations,
  nextRoundRowId,
  recordRoundTransition,
} from "./store";
import { retryBlockedMoves } from "../competitions/advance-status";
import { markRoundsOverdue, shortlistDeadlineOf } from "./overdue";

const WORKER: Actor = { kind: "system", process: "worker" };

/** Opens the competition's missing rounds; returns how many it opened. */
export async function openSchoolRounds(
  deps: { db: AppDb; clock: Clock },
  { competitionId }: { competitionId: string },
  actor: Actor = WORKER
): Promise<number> {
  const opened = await deps.db.transaction(async (tx) => {
    const [held] = await tx
      .select({ status: competition.status })
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("share");
    // Cancelled since, or never got there: nothing to open.
    if (held?.status !== "school_judging") return 0;
    const confirmed = await confirmedRegistrations(tx, competitionId);
    let opened = 0;
    for (const { id } of confirmed) {
      const now = deps.clock.now();
      const [row] = await tx
        .insert(schoolRound)
        .values({
          id: nextRoundRowId(now),
          competitionId,
          institutionRegistrationId: id,
          status: "open",
          openedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: schoolRound.institutionRegistrationId })
        .returning({ id: schoolRound.id });
      if (!row) continue;
      await recordRoundTransition(
        tx,
        { clock: deps.clock, actor },
        { roundId: row.id, from: null, to: "open" }
      );
      opened += 1;
    }
    // Entered school judging only after the shortlist deadline (#90): the
    // rounds are overdue from the start.
    const deadline = await shortlistDeadlineOf(tx, competitionId);
    if (deadline && deadline.getTime() <= deps.clock.now().getTime()) {
      await markRoundsOverdue(tx, { clock: deps.clock, actor }, competitionId);
    }
    return opened;
  });
  if (opened > 0) await retryBlockedMoves(deps, { competitionId });
  return opened;
}
