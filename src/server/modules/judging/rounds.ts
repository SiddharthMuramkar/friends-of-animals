// FOA round configuration. The round row serialises changes to settings, pins,
// status and membership; opening re-pins the then-published immutable rubrics.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionAwardScheme,
  judgingRound,
  judgingRoundRubric,
  rubric,
  roundEntry,
  type JudgingRound,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { AWARD_SCHEMES } from "../competitions/domain/award-schemes";
import {
  JUDGING_LEVELS,
  ROUND_ENTRY_SOURCES,
  roundNameKey,
  roundSettingsSchema,
} from "./domain/round-settings";
import { sourceProblem, type ChainRound } from "./domain/chain";
import { canMoveRound } from "./domain/round-status";
import { pinRubrics } from "./domain/rubric-pins";

export const roundIdInput = z.object({ roundId: z.uuid() });
const createInput = roundSettingsSchema.safeExtend({
  competitionId: z.uuid(),
  awardScheme: z.enum(AWARD_SCHEMES).optional(),
});
const updateInput = z.strictObject({
  roundId: z.uuid(),
  name: roundSettingsSchema.shape.name.optional(),
  level: z.enum(JUDGING_LEVELS).optional(),
  judgesPhysical: z.boolean().optional(),
  entrySource: z.enum(ROUND_ENTRY_SOURCES).optional(),
  sourceRoundId: z.uuid().nullable().optional(),
  awardScheme: z.enum(AWARD_SCHEMES).optional(),
});
export function actorId(ctx: UseCaseContext) {
  return ctx.actor.kind === "user" ? ctx.actor.userId : null;
}
export function competitionScope(id: unknown) {
  return typeof id === "string" && z.uuid().safeParse(id).success
    ? { scopes: [{ type: "competition" as const, id }] }
    : {};
}
export async function loadRound(db: AppDb, id: unknown, lock = false) {
  if (!z.uuid().safeParse(id).success) return null;
  const q = db
    .select()
    .from(judgingRound)
    .where(eq(judgingRound.id, id as string));
  const [row] = await (lock ? q.for("update") : q);
  return row ?? null;
}
export async function authorizeRound(
  ctx: UseCaseContext,
  id: unknown,
  action:
    | "judging.round.manage"
    | "judging.round.read"
    | "judging.round.lock"
    | "judging.round.override"
    | "judging.round.tag"
) {
  const round = await loadRound(ctx.db, id);
  const { role } = await authorize(
    ctx,
    action,
    competitionScope(round?.competitionId)
  );
  return { round, role };
}
/** Lock graph/release state first, before taking any round row locks. */
export async function lockRoundCompetition(db: AppDb, competitionId: string) {
  const [row] = await db
    .select({ status: competition.status })
    .from(competition)
    .where(eq(competition.id, competitionId))
    .for("update");
  return row ?? null;
}
const released = (status: string) => status === "results_published";
const resultsPublished = { ok: false, error: "results_published" } as const;

async function checkSource(
  db: AppDb,
  target: ChainRound,
  sourceRoundId: string | null
) {
  if (!sourceRoundId) return null;
  const rounds = await db
    .select()
    .from(judgingRound)
    .where(eq(judgingRound.competitionId, target.competitionId));
  return sourceProblem(
    [...rounds.filter((r) => r.id !== target.id), target],
    target.id,
    sourceRoundId
  );
}

async function pinsFor(db: AppDb, competitionId: string) {
  const [c] = await db
    .select()
    .from(competition)
    .where(eq(competition.id, competitionId))
    .for("share");
  if (!c) return null;
  const versions = await db
    .select()
    .from(rubric)
    .where(eq(rubric.competitionId, competitionId));
  return pinRubrics(c.disciplines, versions);
}
async function readPins(db: AppDb, roundId: string) {
  return db
    .select({
      discipline: judgingRoundRubric.discipline,
      rubricId: rubric.id,
      version: rubric.version,
    })
    .from(judgingRoundRubric)
    .innerJoin(rubric, eq(rubric.id, judgingRoundRubric.rubricId))
    .where(eq(judgingRoundRubric.roundId, roundId));
}
async function snapshot(db: AppDb, round: JudgingRound) {
  return {
    name: round.name,
    level: round.level,
    awardScheme: round.awardScheme,
    judgesPhysical: round.judgesPhysical,
    status: round.status,
    entrySource: round.entrySource,
    sourceRoundId: round.sourceRoundId,
    pins: await readPins(db, round.id),
  };
}
const notFound = { ok: false, error: "not_found" } as const;
const nameTaken = { ok: false, error: "name_taken" } as const;
export async function createJudgingRound(
  ctx: UseCaseContext,
  input: z.input<typeof createInput>
) {
  const { role } = await authorize(
    ctx,
    "judging.round.manage",
    competitionScope(input.competitionId)
  );
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, awardScheme, ...settings } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const parent = await lockRoundCompetition(tx, competitionId);
    if (!parent) return notFound;
    if (released(parent.status)) return resultsPublished;
    const now = ctx.clock.now();
    const id = uuidv7(now);
    const sourceRoundId = settings.sourceRoundId ?? null;
    const problem = await checkSource(
      tx,
      { id, competitionId, status: "draft", sourceRoundId },
      sourceRoundId
    );
    if (problem) return { ok: false, error: problem } as const;
    const pins = await pinsFor(tx, competitionId);
    if (!pins) return notFound;
    if (!pins.ok)
      return {
        ok: false,
        error: "rubric_missing",
        missing: pins.missing,
      } as const;
    const [award] = await tx
      .select({ scheme: competitionAwardScheme.scheme })
      .from(competitionAwardScheme)
      .where(
        and(
          eq(competitionAwardScheme.competitionId, competitionId),
          eq(competitionAwardScheme.round, "foa_final")
        )
      );
    const [row] = await tx
      .insert(judgingRound)
      .values({
        id,
        competitionId,
        ...settings,
        sourceRoundId,
        nameKey: roundNameKey(settings.name),
        awardScheme: awardScheme ?? award?.scheme ?? "ranked_123",
        createdByUserId: actorId(ctx),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [judgingRound.competitionId, judgingRound.nameKey],
      })
      .returning();
    if (!row) return nameTaken;
    await tx.insert(judgingRoundRubric).values(
      pins.pins.map((p) => ({
        roundId: row.id,
        discipline: p.discipline,
        rubricId: p.rubricId,
      }))
    );
    await recordAudit(tx, ctx, {
      action: "judging_round.created",
      entity: { type: "judging_round", id: row.id },
      before: null,
      after: await snapshot(tx, row),
      actorRole: role,
    });
    return { ok: true, roundId: row.id } as const;
  });
}
export async function updateJudgingRound(
  ctx: UseCaseContext,
  input: z.input<typeof updateInput>
) {
  const { round, role } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.manage"
  );
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!round) return notFound;
  return ctx.db.transaction(async (tx) => {
    // Serialise graph and name edits, and results publication.
    const parent = await lockRoundCompetition(tx, round.competitionId);
    if (!parent) return notFound;
    if (released(parent.status)) return resultsPublished;
    const row = await loadRound(tx, round.id, true);
    if (!row) return notFound;
    if (row.status !== "draft")
      return { ok: false, error: "round_not_editable" } as const;
    const { roundId, ...settings } = parsed.data;
    const entrySource = settings.entrySource ?? row.entrySource;
    const sourceRoundId =
      settings.sourceRoundId !== undefined
        ? settings.sourceRoundId
        : entrySource === "verified_entries"
          ? null
          : row.sourceRoundId;
    if ((entrySource === "round_finalists") !== (sourceRoundId !== null))
      return { ok: false, error: "invalid_input" } as const;
    const changedSource =
      entrySource !== row.entrySource || sourceRoundId !== row.sourceRoundId;
    if (changedSource) {
      const problem = await checkSource(tx, row, sourceRoundId);
      if (problem) return { ok: false, error: problem } as const;
    }
    if (settings.name) {
      const [duplicate] = await tx
        .select({ id: judgingRound.id })
        .from(judgingRound)
        .where(
          and(
            eq(judgingRound.competitionId, row.competitionId),
            eq(judgingRound.nameKey, roundNameKey(settings.name))
          )
        );
      if (duplicate && duplicate.id !== roundId) return nameTaken;
    }
    if (
      changedSource ||
      (settings.judgesPhysical !== undefined &&
        settings.judgesPhysical !== row.judgesPhysical)
    ) {
      const [existing] = await tx
        .select({ id: roundEntry.entryId })
        .from(roundEntry)
        .where(eq(roundEntry.roundId, roundId))
        .limit(1);
      if (existing) return { ok: false, error: "pool_not_empty" } as const;
    }
    const before = await snapshot(tx, row);
    const [updated] = await tx
      .update(judgingRound)
      .set({
        ...settings,
        entrySource,
        sourceRoundId,
        ...(settings.name ? { nameKey: roundNameKey(settings.name) } : {}),
        updatedAt: ctx.clock.now(),
      })
      .where(eq(judgingRound.id, roundId))
      .returning();
    await recordAudit(tx, ctx, {
      action: "judging_round.updated",
      entity: { type: "judging_round", id: roundId },
      before,
      after: await snapshot(tx, updated!),
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
async function transitionRound(
  ctx: UseCaseContext,
  input: { roundId: string; reason?: string },
  to: "open" | "cancelled"
) {
  const { round, role } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.manage"
  );
  const parsed = roundIdInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!round) return notFound;
  const reason = input.reason?.trim();
  if (to === "cancelled" && (!reason || reason.length > 500))
    return { ok: false, error: "reason_required" } as const;
  return ctx.db.transaction(async (tx) => {
    // Always acquire competition before round (same order as settings).
    const parent = await lockRoundCompetition(tx, round.competitionId);
    if (!parent) return notFound;
    if (released(parent.status)) return resultsPublished;
    const pins = to === "open" ? await pinsFor(tx, round.competitionId) : null;
    const row = await loadRound(tx, round.id, true);
    if (!row) return notFound;
    if (!canMoveRound(row.status, to))
      return { ok: false, error: "round_transition_not_allowed" } as const;
    const before = await snapshot(tx, row);
    const now = ctx.clock.now();
    if (to === "open") {
      if (row.sourceRoundId) {
        const source = await loadRound(tx, row.sourceRoundId, true);
        if (!source || source.competitionId !== row.competitionId)
          return { ok: false, error: "source_not_found" } as const;
        if (source.status === "cancelled")
          return { ok: false, error: "source_cancelled" } as const;
        if (source.status !== "locked")
          return { ok: false, error: "source_not_locked" } as const;
      }
      if (!pins?.ok)
        return {
          ok: false,
          error: "rubric_missing",
          missing: pins?.missing ?? [],
        } as const;
      await tx
        .delete(judgingRoundRubric)
        .where(eq(judgingRoundRubric.roundId, row.id));
      await tx.insert(judgingRoundRubric).values(
        pins.pins.map((p) => ({
          roundId: row.id,
          discipline: p.discipline,
          rubricId: p.rubricId,
        }))
      );
    }
    const [updated] = await tx
      .update(judgingRound)
      .set({
        status: to,
        updatedAt: now,
        ...(to === "open"
          ? { openedAt: now, openedByUserId: actorId(ctx) }
          : {
              cancelledAt: now,
              cancelledByUserId: actorId(ctx),
              cancelReason: reason!,
            }),
      })
      .where(
        and(eq(judgingRound.id, row.id), eq(judgingRound.status, row.status))
      )
      .returning();
    await recordAudit(tx, ctx, {
      action:
        to === "open" ? "judging_round.opened" : "judging_round.cancelled",
      entity: { type: "judging_round", id: row.id },
      before,
      after: await snapshot(tx, updated!),
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
export const openJudgingRound = (
  ctx: UseCaseContext,
  input: { roundId: string }
) => transitionRound(ctx, input, "open");
export const cancelJudgingRound = (
  ctx: UseCaseContext,
  input: { roundId: string; reason: string }
) => transitionRound(ctx, input, "cancelled");
export async function getJudgingRound(
  ctx: UseCaseContext,
  input: { roundId: string }
) {
  const { round } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.read"
  );
  if (!round) return notFound;
  return { ok: true, round, pins: await readPins(ctx.db, round.id) } as const;
}
export async function listJudgingRounds(
  ctx: UseCaseContext,
  input: { competitionId?: string } = {}
) {
  if (input.competitionId) {
    await authorize(
      ctx,
      "judging.round.read",
      competitionScope(input.competitionId)
    );
    if (!z.uuid().safeParse(input.competitionId).success) return notFound;
    return {
      ok: true,
      rounds: await ctx.db
        .select()
        .from(judgingRound)
        .where(eq(judgingRound.competitionId, input.competitionId)),
    } as const;
  }
  const grants =
    ctx.actor.kind === "user" ? await grantsOf(ctx.db, ctx.actor.userId) : [];
  const ids = grants.flatMap((g) =>
    g.role === "competition_manager" && g.scope.type === "competition"
      ? [g.scope.id]
      : []
  );
  await authorize(ctx, "judging.round.read", {
    scopes: ids.map((id) => ({ type: "competition", id })),
  });
  const all = grants.some(
    (g) =>
      ["competition_manager", "staff_admin", "super_admin"].includes(g.role) &&
      g.scope.type === "global"
  );
  return {
    ok: true,
    rounds: all
      ? await ctx.db.select().from(judgingRound)
      : await ctx.db
          .select()
          .from(judgingRound)
          .where(inArray(judgingRound.competitionId, ids)),
  } as const;
}
export const roundUseCases = (ctx: UseCaseContext) => ({
  createJudgingRound: (input: z.input<typeof createInput>) =>
    createJudgingRound(ctx, input),
  updateJudgingRound: (input: z.input<typeof updateInput>) =>
    updateJudgingRound(ctx, input),
  openJudgingRound: (input: { roundId: string }) =>
    openJudgingRound(ctx, input),
  cancelJudgingRound: (input: { roundId: string; reason: string }) =>
    cancelJudgingRound(ctx, input),
  getJudgingRound: (input: { roundId: string }) => getJudgingRound(ctx, input),
  listJudgingRounds: (input: { competitionId?: string } = {}) =>
    listJudgingRounds(ctx, input),
});
