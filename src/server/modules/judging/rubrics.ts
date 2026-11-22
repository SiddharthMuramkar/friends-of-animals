// Rubrics (#88): a competition manager writes one per discipline, as a
// draft, and publishes it. A published rubric never changes again; a
// revision is a new draft (the next version) that supersedes it when
// published. Each use case checks `can()` first, for the competition the
// rubric belongs to.
//
//   createRubricDraft({ competitionId, discipline })  → version 1, default criteria
//   updateRubricDraft({ rubricId, criteria })         → replaces a draft's criteria
//   publishRubric({ rubricId })                       → supersedes the old version; rubric.published
//   startRubricRevision({ rubricId })                 → a published rubric's next draft
//   listRubrics({ competitionId })                    → each discipline's state, any refused move
//   getDisciplineRubrics({ competitionId, discipline }) → every version, newest first
//
// The database refuses changes to a rubric that has left draft
// (drizzle/*_88_rubric_immutability.sql); a write that still reaches the
// trigger, by a race, fails as `rubric_not_editable` all the same.

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { Resource } from "../../access/domain/policy";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionTransitionBlock,
  rubric,
  rubricCriterion,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { TRANSITION_BLOCK } from "../competitions/domain/transition-block";
import {
  DISCIPLINES,
  type CompetitionStatus,
  type Discipline,
} from "../competitions/domain/vocabulary";
import {
  defaultRubricCriteria,
  publishProblems,
  rubricCriteriaSchema,
  type RubricCriterion,
  type RubricProblem,
} from "./domain/rubric-criteria";
import { isRubricFrozenError } from "./domain/rubric-freeze";
import { rubricsLocked } from "./domain/rubric-lock";
import { isRubricEditable, type RubricStatus } from "./domain/rubric-status";

/** What the rubric use cases use: the database, the clock and the actor. */
export type RubricContext = Pick<UseCaseContext, "db" | "clock" | "actor">;

/** One version of a discipline's rubric, with its criteria in order. */
export type RubricView = {
  id: string;
  competitionId: string;
  discipline: Discipline;
  version: number;
  status: RubricStatus;
  criteria: RubricCriterion[];
  updatedAt: Date;
  publishedAt: Date | null;
};

export type CompetitionSummary = {
  id: string;
  code: string;
  name: string;
  status: CompetitionStatus;
};

type NotFound = { ok: false; error: "not_found" };
type Locked = { ok: false; error: "rubric_locked_by_judging" };
type NotEditable = { ok: false; error: "rubric_not_editable" };

export type CreateRubricDraftResult =
  | { ok: true; rubric: RubricView }
  | InvalidInput
  | NotFound
  | Locked
  | { ok: false; error: "discipline_not_enabled" | "rubric_exists" };

export type UpdateRubricDraftResult =
  | { ok: true; rubric: RubricView }
  | InvalidInput
  | NotFound
  | NotEditable;

export type PublishRubricResult =
  | { ok: true; rubric: RubricView }
  | InvalidInput
  | NotFound
  | Locked
  | NotEditable
  | { ok: false; error: "not_publishable"; problems: RubricProblem[] };

export type StartRubricRevisionResult =
  | { ok: true; rubric: RubricView }
  | InvalidInput
  | NotFound
  | Locked
  | { ok: false; error: "not_published" | "draft_exists" };

export type DisciplineRubricState = {
  discipline: Discipline;
  published: { id: string; version: number; publishedAt: Date } | null;
  draft: { id: string; version: number } | null;
};

export type SchoolJudgingBlock = { blockedAt: Date; missing: Discipline[] };

export type ListRubricsResult =
  | {
      ok: true;
      competition: CompetitionSummary;
      /** One entry per discipline the competition runs, in its order. */
      disciplines: DisciplineRubricState[];
      /**
       * Set while the schedule's move into school judging is refused: since
       * when, and the disciplines that lacked a published rubric then.
       */
      schoolJudgingBlock: SchoolJudgingBlock | null;
    }
  | InvalidInput
  | NotFound;

export type GetDisciplineRubricsResult =
  | {
      ok: true;
      competition: CompetitionSummary;
      discipline: Discipline;
      /** Whether school judging has started, so nothing more is published. */
      locked: boolean;
      /** Every version, newest first. */
      rubrics: RubricView[];
    }
  | InvalidInput
  | NotFound
  | { ok: false; error: "discipline_not_enabled" };

const competitionInput = z.object({ competitionId: z.uuid() });
const disciplineInput = z.object({
  competitionId: z.uuid(),
  discipline: z.enum(DISCIPLINES),
});
const rubricInput = z.object({ rubricId: z.uuid() });
const updateInput = z.object({
  rubricId: z.uuid(),
  criteria: rubricCriteriaSchema,
});

/** The scope a competition's rubrics sit in, for `can()`. */
function competitionScope(competitionId: unknown): Resource {
  const id = z.uuid().safeParse(competitionId);
  return id.success ? { scopes: [{ type: "competition", id: id.data }] } : {};
}

/** The scope of the competition a rubric belongs to; none if it's unknown. */
async function rubricScope(db: AppDb, rubricId: unknown): Promise<Resource> {
  const id = z.uuid().safeParse(rubricId);
  if (!id.success) return {};
  const [row] = await db
    .select({ competitionId: rubric.competitionId })
    .from(rubric)
    .where(eq(rubric.id, id.data));
  return row ? competitionScope(row.competitionId) : {};
}

type CompetitionRow = CompetitionSummary & { disciplines: Discipline[] };

/**
 * The competition, share-locked when a transaction passes `lock`, so its
 * status can't move into school judging while a rubric is published.
 */
async function loadCompetition(
  db: AppDb,
  competitionId: string,
  lock?: "share"
): Promise<CompetitionRow | null> {
  const query = db
    .select({
      id: competition.id,
      code: competition.code,
      name: competition.name,
      status: competition.status,
      disciplines: competition.disciplines,
    })
    .from(competition)
    .where(eq(competition.id, competitionId));
  const [row] = lock ? await query.for(lock) : await query;
  return row ?? null;
}

function summary({ id, code, name, status }: CompetitionRow) {
  return { id, code, name, status };
}

async function lockRubric(tx: AppDb, rubricId: string) {
  const [row] = await tx
    .select()
    .from(rubric)
    .where(eq(rubric.id, rubricId))
    .for("update");
  return row ?? null;
}

/** Each rubric's criteria, in order; an empty list for one with none. */
export async function criteriaOf(
  db: AppDb,
  rubricIds: readonly string[]
): Promise<Map<string, RubricCriterion[]>> {
  const byRubric = new Map<string, RubricCriterion[]>(
    rubricIds.map((id) => [id, []])
  );
  if (rubricIds.length === 0) return byRubric;
  const rows = await db
    .select()
    .from(rubricCriterion)
    .where(inArray(rubricCriterion.rubricId, [...rubricIds]))
    .orderBy(asc(rubricCriterion.rubricId), asc(rubricCriterion.position));
  for (const {
    rubricId,
    label,
    description,
    weight,
    minScore,
    maxScore,
  } of rows) {
    byRubric
      .get(rubricId)
      ?.push({ label, description, weight, minScore, maxScore });
  }
  return byRubric;
}

function viewOf(
  row: typeof rubric.$inferSelect,
  criteria: RubricCriterion[]
): RubricView {
  return {
    id: row.id,
    competitionId: row.competitionId,
    discipline: row.discipline,
    version: row.version,
    status: row.status,
    criteria,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

async function viewById(db: AppDb, rubricId: string): Promise<RubricView> {
  const [row] = await db.select().from(rubric).where(eq(rubric.id, rubricId));
  if (!row) throw new Error(`Rubric ${rubricId} is gone`);
  const criteria = await criteriaOf(db, [row.id]);
  return viewOf(row, criteria.get(row.id) ?? []);
}

async function insertCriteria(
  tx: AppDb,
  rubricId: string,
  criteria: readonly RubricCriterion[],
  now: Date
): Promise<void> {
  if (criteria.length === 0) return;
  await tx.insert(rubricCriterion).values(
    criteria.map((criterion, position) => ({
      id: uuidv7(now),
      rubricId,
      position,
      ...criterion,
    }))
  );
}

function actorUserId(ctx: RubricContext): string | null {
  return ctx.actor.kind === "user" ? ctx.actor.userId : null;
}

/**
 * Runs a rubric write; the trigger refusing it (a rubric that left draft
 * since it was read) comes back as `rubric_not_editable`.
 */
async function frozenAsNotEditable<T>(
  write: () => Promise<T>
): Promise<T | NotEditable> {
  try {
    return await write();
  } catch (error) {
    if (isRubricFrozenError(error)) {
      return { ok: false, error: "rubric_not_editable" };
    }
    throw error;
  }
}

/**
 * A discipline's first rubric: a draft holding the default criteria (the
 * judging guide the public site shows), for the manager to edit.
 */
export async function createRubricDraft(
  ctx: RubricContext,
  input: { competitionId: string; discipline: Discipline }
): Promise<CreateRubricDraftResult> {
  await authorize(ctx, "rubric.manage", competitionScope(input?.competitionId));
  const parsed = disciplineInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, discipline } = parsed.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const found = await loadCompetition(tx, competitionId, "share");
    if (!found) return { ok: false, error: "not_found" } as const;
    if (rubricsLocked(found.status)) {
      return { ok: false, error: "rubric_locked_by_judging" } as const;
    }
    if (!found.disciplines.includes(discipline)) {
      return { ok: false, error: "discipline_not_enabled" } as const;
    }
    const [existing] = await tx
      .select({ id: rubric.id })
      .from(rubric)
      .where(
        and(
          eq(rubric.competitionId, competitionId),
          eq(rubric.discipline, discipline)
        )
      )
      .limit(1);
    if (existing) return { ok: false, error: "rubric_exists" } as const;

    const id = uuidv7(now);
    const [inserted] = await tx
      .insert(rubric)
      .values({
        id,
        competitionId,
        discipline,
        version: 1,
        status: "draft",
        createdByUserId: actorUserId(ctx),
        createdAt: now,
        updatedAt: now,
      })
      // Another manager's draft, made since the check above.
      .onConflictDoNothing()
      .returning({ id: rubric.id });
    if (!inserted) return { ok: false, error: "rubric_exists" } as const;
    await insertCriteria(tx, id, defaultRubricCriteria(), now);
    return { ok: true, rubric: await viewById(tx, id) } as const;
  });
}

/**
 * Replaces a draft's criteria with `criteria`, in that order. A draft may
 * be half finished: publishing checks the weights, saving doesn't.
 */
export async function updateRubricDraft(
  ctx: RubricContext,
  input: { rubricId: string; criteria: RubricCriterion[] }
): Promise<UpdateRubricDraftResult> {
  await authorize(
    ctx,
    "rubric.manage",
    await rubricScope(ctx.db, input?.rubricId)
  );
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { rubricId, criteria } = parsed.data;
  const now = ctx.clock.now();

  return frozenAsNotEditable(() =>
    ctx.db.transaction(async (tx) => {
      const row = await lockRubric(tx, rubricId);
      if (!row) return { ok: false, error: "not_found" } as const;
      if (!isRubricEditable(row.status)) {
        return { ok: false, error: "rubric_not_editable" } as const;
      }
      await tx
        .delete(rubricCriterion)
        .where(eq(rubricCriterion.rubricId, rubricId));
      await insertCriteria(tx, rubricId, criteria, now);
      await tx
        .update(rubric)
        .set({ updatedAt: now })
        .where(eq(rubric.id, rubricId));
      return { ok: true, rubric: await viewById(tx, rubricId) } as const;
    })
  );
}

/**
 * Publishes a draft whose criteria pass `publishProblems`. The version it
 * replaces, if any, becomes superseded in the same transaction, and the
 * audit log records the change.
 */
export async function publishRubric(
  ctx: RubricContext,
  input: { rubricId: string }
): Promise<PublishRubricResult> {
  const { role } = await authorize(
    ctx,
    "rubric.manage",
    await rubricScope(ctx.db, input?.rubricId)
  );
  const parsed = rubricInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { rubricId } = parsed.data;
  const now = ctx.clock.now();

  return frozenAsNotEditable(() =>
    ctx.db.transaction(async (tx) => {
      const row = await lockRubric(tx, rubricId);
      if (!row) return { ok: false, error: "not_found" } as const;
      const found = await loadCompetition(tx, row.competitionId, "share");
      if (found && rubricsLocked(found.status)) {
        return { ok: false, error: "rubric_locked_by_judging" } as const;
      }
      if (!isRubricEditable(row.status)) {
        return { ok: false, error: "rubric_not_editable" } as const;
      }
      const criteria = (await criteriaOf(tx, [rubricId])).get(rubricId) ?? [];
      const problems = publishProblems(criteria);
      if (problems.length > 0) {
        return { ok: false, error: "not_publishable", problems } as const;
      }

      await tx
        .update(rubric)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(rubric.competitionId, row.competitionId),
            eq(rubric.discipline, row.discipline),
            eq(rubric.status, "published")
          )
        );
      await tx
        .update(rubric)
        .set({
          status: "published",
          publishedAt: now,
          publishedByUserId: actorUserId(ctx),
          updatedAt: now,
        })
        .where(eq(rubric.id, rubricId));
      await recordAudit(tx, ctx, {
        action: "rubric.published",
        entity: { type: "rubric", id: rubricId },
        before: { status: "draft", version: row.version },
        after: { status: "published", version: row.version },
        actorRole: role,
      });
      // A move into school judging the guard refused is tried again.
      await emit(tx, ctx.clock, {
        type: "rubric.published",
        aggregate: { type: "rubric", id: rubricId },
        payload: {
          rubricId,
          competitionId: row.competitionId,
          discipline: row.discipline,
          version: row.version,
        },
      });
      return { ok: true, rubric: await viewById(tx, rubricId) } as const;
    })
  );
}

/**
 * The next version of a published rubric: a draft holding a copy of its
 * criteria. The published one stays in force until the draft is published.
 */
export async function startRubricRevision(
  ctx: RubricContext,
  input: { rubricId: string }
): Promise<StartRubricRevisionResult> {
  await authorize(
    ctx,
    "rubric.manage",
    await rubricScope(ctx.db, input?.rubricId)
  );
  const parsed = rubricInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { rubricId } = parsed.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const row = await lockRubric(tx, rubricId);
    if (!row) return { ok: false, error: "not_found" } as const;
    const found = await loadCompetition(tx, row.competitionId, "share");
    if (found && rubricsLocked(found.status)) {
      return { ok: false, error: "rubric_locked_by_judging" } as const;
    }
    if (row.status !== "published") {
      return { ok: false, error: "not_published" } as const;
    }
    const id = uuidv7(now);
    const [inserted] = await tx
      .insert(rubric)
      .values({
        id,
        competitionId: row.competitionId,
        discipline: row.discipline,
        version: row.version + 1,
        status: "draft",
        createdByUserId: actorUserId(ctx),
        createdAt: now,
        updatedAt: now,
      })
      // The discipline already has a draft (the next version, or another).
      .onConflictDoNothing()
      .returning({ id: rubric.id });
    if (!inserted) return { ok: false, error: "draft_exists" } as const;
    const criteria = (await criteriaOf(tx, [rubricId])).get(rubricId) ?? [];
    await insertCriteria(tx, id, criteria, now);
    return { ok: true, rubric: await viewById(tx, id) } as const;
  });
}

/** The refused move into school judging, if one is open. */
async function schoolJudgingBlockOf(
  db: AppDb,
  competitionId: string
): Promise<SchoolJudgingBlock | null> {
  const [row] = await db
    .select({
      blockedAt: competitionTransitionBlock.blockedAt,
      reason: competitionTransitionBlock.reason,
      details: competitionTransitionBlock.details,
    })
    .from(competitionTransitionBlock)
    .where(
      and(
        eq(competitionTransitionBlock.competitionId, competitionId),
        eq(competitionTransitionBlock.toStatus, "school_judging"),
        isNull(competitionTransitionBlock.resolvedAt)
      )
    );
  if (!row) return null;
  const block = TRANSITION_BLOCK.parse({ ...row.details, reason: row.reason });
  return { blockedAt: row.blockedAt, missing: block.missingDisciplines };
}

/** For the rubrics page: each discipline's published version and draft. */
export async function listRubrics(
  ctx: RubricContext,
  input: { competitionId: string }
): Promise<ListRubricsResult> {
  await authorize(ctx, "rubric.list", competitionScope(input?.competitionId));
  const parsed = competitionInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const found = await loadCompetition(ctx.db, parsed.data.competitionId);
  if (!found) return { ok: false, error: "not_found" };

  const rows = await ctx.db
    .select({
      id: rubric.id,
      discipline: rubric.discipline,
      version: rubric.version,
      status: rubric.status,
      publishedAt: rubric.publishedAt,
    })
    .from(rubric)
    .where(
      and(
        eq(rubric.competitionId, found.id),
        inArray(rubric.status, ["draft", "published"])
      )
    );
  return {
    ok: true,
    competition: summary(found),
    schoolJudgingBlock: await schoolJudgingBlockOf(ctx.db, found.id),
    disciplines: found.disciplines.map((discipline) => {
      const ofDiscipline = rows.filter((row) => row.discipline === discipline);
      const published = ofDiscipline.find((row) => row.status === "published");
      const draft = ofDiscipline.find((row) => row.status === "draft");
      return {
        discipline,
        published:
          published && published.publishedAt
            ? {
                id: published.id,
                version: published.version,
                publishedAt: published.publishedAt,
              }
            : null,
        draft: draft ? { id: draft.id, version: draft.version } : null,
      };
    }),
  };
}

/** For a discipline's rubric page: every version, newest first. */
export async function getDisciplineRubrics(
  ctx: RubricContext,
  input: { competitionId: string; discipline: Discipline }
): Promise<GetDisciplineRubricsResult> {
  await authorize(ctx, "rubric.list", competitionScope(input?.competitionId));
  const parsed = disciplineInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, discipline } = parsed.data;
  const found = await loadCompetition(ctx.db, competitionId);
  if (!found) return { ok: false, error: "not_found" };
  if (!found.disciplines.includes(discipline)) {
    return { ok: false, error: "discipline_not_enabled" };
  }

  const rows = await ctx.db
    .select()
    .from(rubric)
    .where(
      and(
        eq(rubric.competitionId, competitionId),
        eq(rubric.discipline, discipline)
      )
    )
    .orderBy(desc(rubric.version));
  const criteria = await criteriaOf(
    ctx.db,
    rows.map((row) => row.id)
  );
  return {
    ok: true,
    competition: summary(found),
    discipline,
    locked: rubricsLocked(found.status),
    rubrics: rows.map((row) => viewOf(row, criteria.get(row.id) ?? [])),
  };
}
