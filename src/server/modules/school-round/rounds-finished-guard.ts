// The FOA-judging guard (#90): a competition moves from school judging to
// FOA judging (at its shortlist deadline) only once every confirmed
// school's round is finished: finalised by the school, or closed on its
// behalf by a competition manager. A confirmed school whose round never
// opened counts as unfinished. The competition status machine runs it
// (../competitions/transition-guards.ts); while it refuses, the
// competition's managers are told, and the move is tried again whenever a
// round finishes.
//
// Loads under plain Node (the worker): relative imports only.

import { eq } from "drizzle-orm";
import { schoolRound } from "../../db/schema";
import type { CompetitionTransitionGuard } from "../competitions/domain/transition-block";
import { checkSchoolRoundsFinished } from "./domain/deadline";
import { confirmedRegistrations } from "./store";

export const foaJudgingNeedsFinishedSchoolRounds: CompetitionTransitionGuard = {
  from: "school_judging",
  to: "foa_judging",
  retryOn: [
    "school_round.shortlist_finalised",
    "school_round.closed_on_behalf",
  ],
  async check(db, guarded) {
    const confirmed = await confirmedRegistrations(db, guarded.id);
    const rounds = await db
      .select({
        id: schoolRound.institutionRegistrationId,
        roundStatus: schoolRound.status,
      })
      .from(schoolRound)
      .where(eq(schoolRound.competitionId, guarded.id));
    const schools = [
      ...rounds,
      ...confirmed.filter((school) => school.roundStatus === null),
    ];
    const verdict = checkSchoolRoundsFinished(
      schools.map((school) => ({
        institutionRegistrationId: school.id,
        roundStatus: school.roundStatus,
      }))
    );
    return verdict.pass ? null : { reason: verdict.reason, ...verdict.details };
  },
};
