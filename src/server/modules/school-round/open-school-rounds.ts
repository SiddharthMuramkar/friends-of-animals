// Opening a competition's school rounds (#89), by the outbox handler
// school_round.open_rounds after competition.school_judging_started: one
// open round per confirmed institution registration, that is an active one
// with at least one confirmed student, even if none of them submitted. The
// round exists for schools that never visit and for the overdue job (#90).
// Running again adds nothing: the round's registration is unique.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, exists } from "drizzle-orm";

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  institutionRegistration,
  registration,
  schoolRound,
} from "../../db/schema";
import type { Clock } from "../../ports/clock";
import { nextRoundRowId, recordRoundTransition } from "./store";

const WORKER: Actor = { kind: "system", process: "worker" };

/** Opens the competition's missing rounds; returns how many it opened. */
export async function openSchoolRounds(
  deps: { db: AppDb; clock: Clock },
  { competitionId }: { competitionId: string },
  actor: Actor = WORKER
): Promise<number> {
  return deps.db.transaction(async (tx) => {
    const [held] = await tx
      .select({ status: competition.status })
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("share");
    // Cancelled since, or never got there: nothing to open.
    if (held?.status !== "school_judging") return 0;
    const confirmed = await tx
      .select({ id: institutionRegistration.id })
      .from(institutionRegistration)
      .where(
        and(
          eq(institutionRegistration.competitionId, competitionId),
          eq(institutionRegistration.status, "active"),
          exists(
            tx
              .select({ id: registration.id })
              .from(registration)
              .where(
                and(
                  eq(
                    registration.institutionRegistrationId,
                    institutionRegistration.id
                  ),
                  eq(registration.status, "confirmed")
                )
              )
          )
        )
      )
      .orderBy(institutionRegistration.id);
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
    return opened;
  });
}
