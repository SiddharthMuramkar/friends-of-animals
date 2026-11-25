import { z } from "zod";
import { eq } from "drizzle-orm";
import { criterionScore, scoreSheet } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { recordAudit } from "../../../audit/record";
import { invalidInput } from "../../../input";
import { can } from "../../../access/can";
import type { UseCaseContext } from "../../../use-cases";
import { loadJudgeReadiness } from "../judges";
import { loadRound } from "../rounds";
import { decideScoringAccess } from "./domain/scoring-access";
import {
  assignedWork,
  loadSheet,
  pinnedCriteria,
  startedSheetIds,
} from "./queries";
import { toBlindEntryView } from "./domain/blind-entry-view";
import {
  applyScoreSheetPatch,
  scoringProgress,
  scoreSheetPatchSchema,
  type ScoreSheet,
  type ScoreSheetPatch,
} from "./domain/score-sheet";
import { blindThumbnails, blindWorkMedia } from "./media";
const notFound = { ok: false, error: "entry_not_found" } as const;

// Every blind read and save uses the same round-scoped check. Different
// rounds, missing entries and unassigned entries are indistinguishable.
async function scoringRound(
  ctx: UseCaseContext,
  roundId: string,
  intent: "read" | "write",
  lock = false
) {
  if (ctx.actor.kind !== "user" || !z.uuid().safeParse(roundId).success)
    return notFound;
  if (
    !(
      await can(ctx, intent === "read" ? "score.read" : "score.write", {
        scopes: [{ type: "round", id: roundId }],
      })
    ).allowed
  )
    return notFound;
  const round = await loadRound(ctx.db, roundId, lock);
  const judgeUserId = ctx.actor.userId;
  const readiness = await loadJudgeReadiness(ctx.db, { roundId, judgeUserId });
  const decision = decideScoringAccess(
    {
      roundStatus: round?.status ?? null,
      onboarded: readiness.ready,
      assigned: true,
    },
    "read"
  );
  if (!decision.ok) return { ok: false, error: decision.code } as const;
  if (!round) return notFound;
  return { ok: true, round, judgeUserId } as const;
}

async function listMyAssignments(
  ctx: UseCaseContext,
  input: { roundId: string }
) {
  const access = await scoringRound(ctx, input.roundId, "read");
  if (!access.ok) return access;
  const { round, judgeUserId } = access;
  const assigned = await assignedWork(ctx.db, round.id, judgeUserId);
  const started = await startedSheetIds(
    ctx.db,
    assigned.flatMap((a) => (a.scoreSheetId ? [a.scoreSheetId] : []))
  );
  const thumbnails = await blindThumbnails(
    ctx,
    assigned.map((a) => a.entryId)
  );
  const entries = assigned.map((a) => ({
    entryCode: a.entryCode,
    discipline: a.discipline,
    categoryLabel: a.categoryLabel,
    ageGroupLabel: a.ageGroupLabel,
    thumbnailUrl: thumbnails.get(a.entryId) ?? null,
    progress: a.complete
      ? ("complete" as const)
      : a.comment || (a.scoreSheetId && started.has(a.scoreSheetId))
        ? ("in_progress" as const)
        : ("not_started" as const),
  }));
  return {
    ok: true,
    round: { id: round.id, name: round.name, status: round.status },
    entries,
  } as const;
}

export type BlindEntryInput = { roundId: string; entryCode: string };
async function getBlindEntry(ctx: UseCaseContext, input: BlindEntryInput) {
  const access = await scoringRound(ctx, input.roundId, "read");
  if (!access.ok) return access;
  const { round, judgeUserId } = access;
  const assigned = await assignedWork(ctx.db, round.id, judgeUserId);
  const index = assigned.findIndex((a) => a.entryCode === input.entryCode);
  const item = assigned[index];
  if (!item) return notFound;
  const criteria = await pinnedCriteria(ctx.db, round.id, item.discipline);
  const { sheet } = await loadSheet(
    ctx.db,
    round.id,
    item.entryId,
    judgeUserId
  );
  const view = toBlindEntryView({
    entryCode: item.entryCode,
    discipline: item.discipline,
    categoryLabel: item.categoryLabel,
    ageGroupLabel: item.ageGroupLabel,
    media: await blindWorkMedia(ctx, item.entryId),
  });
  return {
    ok: true,
    round: { id: round.id, name: round.name, status: round.status },
    view,
    criteria,
    sheet,
    progress: scoringProgress(criteria, sheet),
    previousEntryCode: assigned[index - 1]?.entryCode ?? null,
    nextEntryCode: assigned[index + 1]?.entryCode ?? null,
  } as const;
}

export type SaveScoreSheetInput = BlindEntryInput & ScoreSheetPatch;
const saveInput = scoreSheetPatchSchema.extend({
  roundId: z.uuid(),
  entryCode: z.string().min(1).max(64),
});

// Completion audit shows numerical changes but never copies free-text
// comments into the append-only log (they might contain personal data).
function scoreAudit(sheet: ScoreSheet, complete: boolean) {
  return {
    version: sheet.version,
    complete,
    scores: Object.fromEntries(
      Object.entries(sheet.scores).map(([id, score]) => [id, score.value])
    ),
    commentVersion: sheet.comment.changedAtVersion,
  };
}
async function saveScoreSheet(ctx: UseCaseContext, input: SaveScoreSheetInput) {
  return ctx.db.transaction(async (tx) => {
    // Lock the round before looking at its assignment/score. #95 uses the
    // same lock for conflict/removal mutations, and #97 uses it for lock.
    const access = await scoringRound(
      { ...ctx, db: tx },
      input.roundId,
      "write",
      true
    );
    if (!access.ok) return access;
    const { round, judgeUserId } = access;
    const assigned = await assignedWork(tx, round.id, judgeUserId);
    const item = assigned.find((a) => a.entryCode === input.entryCode);
    const decision = decideScoringAccess(
      { roundStatus: round.status, onboarded: true, assigned: Boolean(item) },
      "write"
    );
    if (!decision.ok) return { ok: false, error: decision.code } as const;
    if (!item) return notFound;
    const parsed = saveInput.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const criteria = await pinnedCriteria(tx, round.id, item.discipline);
    if (!criteria.length) return notFound;
    const { row, sheet } = await loadSheet(
      tx,
      round.id,
      item.entryId,
      judgeUserId
    );
    const result = applyScoreSheetPatch(criteria, sheet, parsed.data);
    if (!result.ok)
      return {
        ok: false,
        error: "invalid_scores",
        problems: result.problems,
      } as const;
    if (result.changed) {
      const next = result.sheet;
      const now = ctx.clock.now();
      const id = row?.id ?? uuidv7(now);
      const complete = result.progress === "complete";
      const fields = {
        comment: next.comment.text,
        commentVersion: next.comment.changedAtVersion,
        complete,
        version: next.version,
        completedAt: row?.completedAt ?? (complete ? now : null),
        updatedAt: now,
      };
      if (row)
        await tx.update(scoreSheet).set(fields).where(eq(scoreSheet.id, id));
      else
        await tx
          .insert(scoreSheet)
          .values({
            id,
            roundId: round.id,
            entryId: item.entryId,
            judgeUserId,
            createdAt: now,
            ...fields,
          });
      for (const [criterionId, score] of Object.entries(next.scores)) {
        if (score.changedAtVersion !== next.version) continue;
        await tx
          .insert(criterionScore)
          .values({ scoreSheetId: id, criterionId, ...score })
          .onConflictDoUpdate({
            target: [criterionScore.scoreSheetId, criterionScore.criterionId],
            set: score,
          });
      }
      if (row?.completedAt || complete)
        await recordAudit(tx, ctx, {
          action: row?.completedAt
            ? "score_sheet.changed"
            : "score_sheet.completed",
          entity: { type: "score_sheet", id },
          before: scoreAudit(sheet, row?.complete ?? false),
          after: scoreAudit(next, complete),
          actorRole: "judge",
        });
    }
    return result;
  });
}

export const blindJudgingUseCases = (ctx: UseCaseContext) => ({
  saveScoreSheet: (input: SaveScoreSheetInput) => saveScoreSheet(ctx, input),
  getBlindEntry: (input: BlindEntryInput) => getBlindEntry(ctx, input),
  listMyAssignments: (input: Parameters<typeof listMyAssignments>[1]) =>
    listMyAssignments(ctx, input),
});
