import { and, count, eq, gte, lt, ne, or, isNotNull } from "drizzle-orm";
import { surveyInvitation, survey } from "../../db/schema";
import type { AppDb } from "../../db/app-db";

/** Trusted aggregate-only seam, called after authorization by the owner report. */
export async function readSurveyResults(
  db: AppDb,
  row: typeof survey.$inferSelect
) {
  const rows = await db
    .select({
      status: surveyInvitation.status,
      answers: surveyInvitation.answers,
    })
    .from(surveyInvitation)
    .where(eq(surveyInvitation.surveyId, row.id));
  const answered = rows.flatMap((r) => (r.answers ? [r.answers] : []));
  const counts = row.questions.map((q, i) =>
    q.choices.map((_, j) => answered.filter((a) => a[i] === j).length)
  );
  const invited = rows.filter(
    (r) => r.status !== "skipped" || r.answers !== null
  ).length;
  return {
    invited,
    responses: answered.length,
    counts,
    responseRate: invited
      ? Math.round((answered.length / invited) * 1000) / 10
      : null,
  };
}

/** Leadership period report: one count per survey sent and recipient invited
 * during the half-open send period, and actual answers submitted during the
 * half-open answer period (including surveys opened earlier).
 * Retained records only; erasure and retention remove the linked data. */
export async function surveyFeedbackMetrics(
  db: AppDb,
  { from, to }: { from: Date; to: Date }
) {
  const [surveys, invited, responses] = await Promise.all([
    db
      .select({ n: count() })
      .from(survey)
      .where(and(gte(survey.sentAt, from), lt(survey.sentAt, to))),
    db
      .select({ n: count() })
      .from(surveyInvitation)
      .innerJoin(survey, eq(survey.id, surveyInvitation.surveyId))
      .where(
        and(
          gte(survey.sentAt, from),
          lt(survey.sentAt, to),
          or(
            ne(surveyInvitation.status, "skipped"),
            isNotNull(surveyInvitation.answeredAt)
          )
        )
      ),
    db
      .select({ n: count() })
      .from(surveyInvitation)
      .where(
        and(
          gte(surveyInvitation.answeredAt, from),
          lt(surveyInvitation.answeredAt, to)
        )
      ),
  ]);
  return {
    surveysSent: surveys[0]!.n,
    invited: invited[0]!.n,
    responses: responses[0]!.n,
  };
}
