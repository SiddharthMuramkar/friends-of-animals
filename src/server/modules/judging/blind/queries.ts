// Only judged-work fields enter this module. Queries never read entrant
// details. Live conflict and category checks use the judging module's
// narrow seams rather than joining the identity-bearing tables here.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../../db/app-db";
import {
  criterionScore,
  entry,
  judgingRoundRubric,
  roundAssignment,
  rubricCriterion,
  scoreSheet,
} from "../../../db/schema";
import { conflictedEntryIds } from "../conflict-facts";
import { entryAgeGroupLabels } from "../entry-categories";
import type { Discipline } from "../../competitions/domain/vocabulary";
import { EMPTY_SCORE_SHEET, type ScoreSheet } from "./domain/score-sheet";

export async function assignedWork(
  db: AppDb,
  roundId: string,
  judgeUserId: string
) {
  const rows = await db
    .select({
      entryId: entry.id,
      entryCode: entry.code,
      discipline: entry.discipline,
      scoreSheetId: scoreSheet.id,
      complete: scoreSheet.complete,
      comment: scoreSheet.comment,
    })
    .from(roundAssignment)
    .innerJoin(entry, eq(entry.id, roundAssignment.entryId))
    .leftJoin(
      scoreSheet,
      and(
        eq(scoreSheet.roundId, roundAssignment.roundId),
        eq(scoreSheet.entryId, roundAssignment.entryId),
        eq(scoreSheet.judgeUserId, roundAssignment.judgeUserId)
      )
    )
    .where(
      and(
        eq(roundAssignment.roundId, roundId),
        eq(roundAssignment.judgeUserId, judgeUserId)
      )
    )
    .orderBy(asc(entry.code));
  const conflicts = await conflictedEntryIds(db, roundId, judgeUserId);
  const allowed = rows.filter((row) => !conflicts.has(row.entryId));
  const labels = await entryAgeGroupLabels(
    db,
    allowed.map((row) => row.entryId)
  );
  return allowed.map((row) => {
    const ageGroupLabel = labels.get(row.entryId) ?? null;
    return {
      ...row,
      ageGroupLabel,
      categoryLabel: [
        row.discipline[0]!.toUpperCase() + row.discipline.slice(1),
        ageGroupLabel,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

export async function startedSheetIds(db: AppDb, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db
    .select({ id: criterionScore.scoreSheetId, value: criterionScore.value })
    .from(criterionScore)
    .where(inArray(criterionScore.scoreSheetId, ids));
  return new Set(rows.filter((r) => r.value !== null).map((r) => r.id));
}

export async function pinnedCriteria(
  db: AppDb,
  roundId: string,
  discipline: Discipline
) {
  return db
    .select({
      id: rubricCriterion.id,
      label: rubricCriterion.label,
      description: rubricCriterion.description,
      weight: rubricCriterion.weight,
      minScore: rubricCriterion.minScore,
      maxScore: rubricCriterion.maxScore,
    })
    .from(judgingRoundRubric)
    .innerJoin(
      rubricCriterion,
      eq(rubricCriterion.rubricId, judgingRoundRubric.rubricId)
    )
    .where(
      and(
        eq(judgingRoundRubric.roundId, roundId),
        eq(judgingRoundRubric.discipline, discipline)
      )
    )
    .orderBy(asc(rubricCriterion.position));
}

export async function loadSheet(
  db: AppDb,
  roundId: string,
  entryId: string,
  judgeUserId: string
) {
  const [row] = await db
    .select()
    .from(scoreSheet)
    .where(
      and(
        eq(scoreSheet.roundId, roundId),
        eq(scoreSheet.entryId, entryId),
        eq(scoreSheet.judgeUserId, judgeUserId)
      )
    );
  if (!row) return { row: null, sheet: EMPTY_SCORE_SHEET };
  const scores = await db
    .select({
      criterionId: criterionScore.criterionId,
      value: criterionScore.value,
      changedAtVersion: criterionScore.changedAtVersion,
    })
    .from(criterionScore)
    .where(eq(criterionScore.scoreSheetId, row.id));
  const sheet: ScoreSheet = {
    version: row.version,
    comment: { text: row.comment, changedAtVersion: row.commentVersion },
    scores: Object.fromEntries(
      scores.map(({ criterionId, ...score }) => [criterionId, score])
    ),
  };
  return { row, sheet };
}
