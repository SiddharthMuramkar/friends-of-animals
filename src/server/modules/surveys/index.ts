import { and, eq, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { competition, survey, surveyInvitation } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { hashLinkToken } from "../../crypto/link-token";
import { emitBatch } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import type { AppDb } from "../../db/app-db";
import { BOM, formatCsv, neutraliseFormula } from "../registration/domain/csv";
import { readSetting } from "../settings/read";
import { surveyDraft, validAnswers } from "./questions";
import { reportScope } from "../reports/scope";
import { surveyAudience } from "./audience";
import { surveyToken } from "./token";
import { isOpen, publicationExists } from "./eligibility";
import { readSurveyResults } from "./results";
const unavailable = { ok: false, error: "unavailable" } as const;
const invalid = { ok: false, error: "invalid_input" } as const;
const resource = (id: string) => ({
  scopes: [{ type: "competition" as const, id }],
});
const load = async (db: AppDb, competitionId: string) =>
  (
    await db
      .select()
      .from(survey)
      .where(eq(survey.competitionId, competitionId))
  )[0];
async function saveSurvey(
  ctx: UseCaseContext,
  input: { competitionId: string; title: unknown; questions: unknown }
) {
  const { role } = await authorize(
    ctx,
    "survey.manage",
    resource(input.competitionId)
  );
  const parsed = surveyDraft.safeParse({
    title: input.title,
    questions: input.questions,
  });
  if (!z.uuid().safeParse(input.competitionId).success || !parsed.success)
    return invalid;
  return ctx.db.transaction(async (tx) => {
    const [comp] = await tx
      .select({ id: competition.id })
      .from(competition)
      .where(eq(competition.id, input.competitionId))
      .for("update");
    if (!comp) return unavailable;
    const row = await load(tx, comp.id);
    if (row?.sentAt) return unavailable;
    const now = ctx.clock.now();
    const id = row?.id ?? uuidv7(now);
    if (row)
      await tx
        .update(survey)
        .set({ ...parsed.data, updatedAt: now })
        .where(and(eq(survey.id, id), isNull(survey.sentAt)));
    else
      await tx.insert(survey).values({
        id,
        competitionId: comp.id,
        ...parsed.data,
        createdAt: now,
        updatedAt: now,
      });
    await recordAudit(tx, ctx, {
      action: "survey.saved",
      entity: { type: "survey", id },
      actorRole: role,
      before: null,
      after: { questionCount: parsed.data.questions.length },
    });
    return { ok: true, id } as const;
  });
}
async function sendSurvey(
  ctx: UseCaseContext,
  { competitionId }: { competitionId: string }
) {
  const { role } = await authorize(
    ctx,
    "survey.manage",
    resource(competitionId)
  );
  if (!z.uuid().safeParse(competitionId).success) return invalid;
  if (!(await readSetting(ctx.db, "surveys.enabled")))
    return { ok: false, error: "disabled" } as const;
  return ctx.db.transaction(async (tx) => {
    await tx
      .select({ id: competition.id })
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("update");
    const row = await load(tx, competitionId);
    if (!row || row.sentAt) return unavailable;
    const now = ctx.clock.now();
    if (!(await publicationExists(tx, competitionId, now)))
      return { ok: false, error: "results_not_published" } as const;
    const recipients = await surveyAudience({ ...ctx, db: tx }, competitionId);
    if (!recipients.length)
      return { ok: false, error: "no_recipients" } as const;
    const closesAt = new Date(now.getTime() + 30 * 86400000);
    const rows = recipients.map((userId) => {
      const id = uuidv7(now);
      return {
        id,
        surveyId: row.id,
        userId,
        createdAt: now,
        tokenHash: surveyToken(ctx.blindIndex, id).tokenHash,
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      await tx.insert(surveyInvitation).values(batch);
      await emitBatch(
        tx,
        ctx.clock,
        batch.map((r) => ({
          type: "survey.invitation_due",
          aggregate: { type: "survey_invitation", id: r.id },
          payload: { invitationId: r.id },
        }))
      );
    }
    await tx
      .update(survey)
      .set({ sentAt: now, closesAt, updatedAt: now })
      .where(eq(survey.id, row.id));
    await recordAudit(tx, ctx, {
      action: "survey.sent",
      entity: { type: "survey", id: row.id },
      actorRole: role,
      before: null,
      after: { invited: rows.length },
    });
    return { ok: true, invited: rows.length } as const;
  });
}
async function closeSurvey(
  ctx: UseCaseContext,
  { competitionId }: { competitionId: string }
) {
  const { role } = await authorize(
    ctx,
    "survey.manage",
    resource(competitionId)
  );
  if (!z.uuid().safeParse(competitionId).success) return invalid;
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(survey)
      .where(eq(survey.competitionId, competitionId))
      .for("update");
    if (!row || !isOpen(row, ctx.clock.now())) return unavailable;
    await tx
      .update(survey)
      .set({ closedAt: ctx.clock.now() })
      .where(eq(survey.id, row.id));
    await recordAudit(tx, ctx, {
      action: "survey.closed",
      entity: { type: "survey", id: row.id },
      actorRole: role,
      before: { open: true },
      after: { open: false },
    });
    return { ok: true } as const;
  });
}
async function listSurveyCompetitions(ctx: UseCaseContext) {
  const scope = await reportScope(ctx, "survey.manage");
  if (scope !== "all" && !scope.length) await authorize(ctx, "survey.manage");
  return ctx.db
    .select({
      id: competition.id,
      name: competition.name,
      code: competition.code,
    })
    .from(competition)
    .where(scope === "all" ? undefined : inArray(competition.id, [...scope]))
    .orderBy(competition.name);
}
async function getSurvey(
  ctx: UseCaseContext,
  { competitionId }: { competitionId: string }
) {
  await authorize(ctx, "survey.manage", resource(competitionId));
  if (!z.uuid().safeParse(competitionId).success) return null;
  const [comp] = await ctx.db
    .select({ name: competition.name, code: competition.code })
    .from(competition)
    .where(eq(competition.id, competitionId));
  if (!comp) return null;
  const row = await load(ctx.db, competitionId);
  return {
    competition: comp,
    survey: row ?? null,
    published: await publicationExists(ctx.db, competitionId, ctx.clock.now()),
    open: row ? isOpen(row, ctx.clock.now()) : false,
    results: row?.sentAt ? await readSurveyResults(ctx.db, row) : null,
  };
}
async function exportSurvey(
  ctx: UseCaseContext,
  input: { competitionId: string }
) {
  const { role } = await authorize(
    ctx,
    "survey.manage",
    resource(input.competitionId)
  );
  return ctx.db.transaction(async (tx) => {
    const view = await getSurvey({ ...ctx, db: tx }, input);
    if (!view?.survey || !view.results) return unavailable;
    const { results } = view;
    const rows = [
      ["Invited", "Responses", "Response rate (%)"],
      [
        String(results.invited),
        String(results.responses),
        String(results.responseRate ?? ""),
      ],
      ["Question", "Choice", "Count"],
    ];
    view.survey.questions.forEach((q, i) =>
      q.choices.forEach((label, j) =>
        rows.push([
          neutraliseFormula(q.text),
          neutraliseFormula(label),
          String(results.counts[i]![j]),
        ])
      )
    );
    await recordAudit(tx, ctx, {
      action: "survey.exported",
      entity: { type: "survey", id: view.survey.id },
      actorRole: role,
      before: null,
      after: { format: "csv", aggregate: true },
    });
    return {
      ok: true,
      csv: BOM + formatCsv(rows),
      filename: `${view.competition.code}-feedback.csv`,
    } as const;
  });
}
type Target = { token: string } | { competitionId: string };
async function targetRow(ctx: UseCaseContext, target: Target) {
  if ("token" in target) {
    await authorize(ctx, "survey.link");
    if (!/^[a-f0-9]{64}$/.test(target.token)) return null;
    return (
      (
        await ctx.db
          .select({ invitation: surveyInvitation, row: survey })
          .from(surveyInvitation)
          .innerJoin(survey, eq(survey.id, surveyInvitation.surveyId))
          .where(eq(surveyInvitation.tokenHash, hashLinkToken(target.token)))
      )[0] ?? null
    );
  }
  await authorize(ctx, "survey.dashboard");
  if (
    ctx.actor.kind !== "user" ||
    !z.uuid().safeParse(target.competitionId).success
  )
    return null;
  return (
    (
      await ctx.db
        .select({ invitation: surveyInvitation, row: survey })
        .from(surveyInvitation)
        .innerJoin(survey, eq(survey.id, surveyInvitation.surveyId))
        .where(
          and(
            eq(surveyInvitation.userId, ctx.actor.userId),
            eq(survey.competitionId, target.competitionId)
          )
        )
    )[0] ?? null
  );
}
async function eligible(
  ctx: UseCaseContext,
  row: typeof survey.$inferSelect,
  invitation: typeof surveyInvitation.$inferSelect
) {
  return (
    !invitation.answeredAt &&
    invitation.status !== "skipped" &&
    isOpen(row, ctx.clock.now()) &&
    (await readSetting(ctx.db, "surveys.enabled")) &&
    (await publicationExists(ctx.db, row.competitionId, ctx.clock.now())) &&
    (await surveyAudience(ctx, row.competitionId, invitation.userId)).includes(
      invitation.userId
    )
  );
}
async function getSurveyAnswerForm(ctx: UseCaseContext, target: Target) {
  const found = await targetRow(ctx, target);
  if (!found || !(await eligible(ctx, found.row, found.invitation)))
    return null;
  return {
    title: found.row.title,
    questions: found.row.questions,
    closesAt: found.row.closesAt!,
  };
}
async function mySurveys(ctx: UseCaseContext) {
  await authorize(ctx, "survey.dashboard");
  if (ctx.actor.kind !== "user") return [];
  const rows = await ctx.db
    .select({ invitation: surveyInvitation, row: survey })
    .from(surveyInvitation)
    .innerJoin(survey, eq(survey.id, surveyInvitation.surveyId))
    .where(eq(surveyInvitation.userId, ctx.actor.userId));
  const result = [];
  for (const { row, invitation } of rows)
    if (await eligible(ctx, row, invitation))
      result.push({
        competitionId: row.competitionId,
        title: row.title,
        closesAt: row.closesAt!,
      });
  return result;
}
async function answerSurvey(
  ctx: UseCaseContext,
  input: Target & { answers: unknown }
) {
  const found = await targetRow(ctx, input);
  if (!found) return unavailable;
  return ctx.db.transaction(async (tx) => {
    // Serialize closure, concurrent responses and the one-person invariant.
    const [row] = await tx
      .select()
      .from(survey)
      .where(eq(survey.id, found.row.id))
      .for("update");
    const [invitation] = await tx
      .select()
      .from(surveyInvitation)
      .where(eq(surveyInvitation.id, found.invitation.id))
      .for("update");
    if (
      !row ||
      !invitation ||
      !(await eligible({ ...ctx, db: tx }, row, invitation))
    )
      return unavailable;
    if (!validAnswers(row.questions, input.answers)) return invalid;
    const [updated] = await tx
      .update(surveyInvitation)
      .set({ answers: input.answers, answeredAt: ctx.clock.now() })
      .where(
        and(
          eq(surveyInvitation.id, invitation.id),
          isNull(surveyInvitation.answeredAt)
        )
      )
      .returning({ id: surveyInvitation.id });
    if (!updated) return unavailable;
    await recordAudit(tx, ctx, {
      action: "survey.answered",
      entity: { type: "survey_invitation", id: updated.id },
      actorRole: null,
      before: null,
      after: { answered: true },
    });
    return { ok: true } as const;
  });
}
export const surveysUseCases = (ctx: UseCaseContext) => ({
  listSurveyCompetitions: () => listSurveyCompetitions(ctx),
  getSurvey: (input: { competitionId: string }) => getSurvey(ctx, input),
  saveSurvey: (input: {
    competitionId: string;
    title: unknown;
    questions: unknown;
  }) => saveSurvey(ctx, input),
  sendSurvey: (input: { competitionId: string }) => sendSurvey(ctx, input),
  closeSurvey: (input: { competitionId: string }) => closeSurvey(ctx, input),
  exportSurvey: (input: { competitionId: string }) => exportSurvey(ctx, input),
  mySurveys: () => mySurveys(ctx),
  getSurveyAnswerForm: (target: Target) => getSurveyAnswerForm(ctx, target),
  answerSurvey: (input: Target & { answers: unknown }) =>
    answerSurvey(ctx, input),
});
