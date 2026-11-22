// The school-judging guard (#88): a competition enters school judging only
// once every discipline it runs has a published rubric, so schools always
// score against rules everyone could read first. Individuals-only
// competitions pass through school judging too, under the same guard
// (owner, 2026-11-19). The competition status machine runs it
// (../competitions/transition-guards.ts); judging never moves a status.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";

import { rubric } from "../../db/schema";
import type { CompetitionTransitionGuard } from "../competitions/domain/transition-block";
import { rubricCoverage } from "./domain/rubric-coverage";

export const schoolJudgingNeedsPublishedRubrics: CompetitionTransitionGuard = {
  from: "registration_closed",
  to: "school_judging",
  retryOn: [],
  async check(db, competition) {
    const published = await db
      .select({ discipline: rubric.discipline, status: rubric.status })
      .from(rubric)
      .where(
        and(
          eq(rubric.competitionId, competition.id),
          eq(rubric.status, "published")
        )
      );
    const coverage = rubricCoverage(competition.disciplines, published);
    return coverage.complete
      ? null
      : { reason: "rubrics_missing", missingDisciplines: coverage.missing };
  },
};
