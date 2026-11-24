// Creating and opening competitions in the admin area (#70).
//
//   createCompetition({ code, name, ... })            → a global competition manager
//   getCompetitionForEdit({ competitionId })          → a manager covering it
//   updateCompetition({ competitionId, ...changes })  → a manager covering it
//   listCompetitionsForAdmin()                        → any competition manager
//
// Expected refusals come back as results; an actor the policy refuses gets
// DomainError("forbidden"). Loads under plain Node: relative imports only.

import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authorize, can } from "../../access/can";
import type { Resource } from "../../access/domain/policy";
import { grantsOf } from "../../access/grants";
import type { AppDb } from "../../db/app-db";
import { recordAudit } from "../../audit/record";
import { competition } from "../../db/schema";
import { sqlState } from "../../errors";
import { uuidv7 } from "../../ids";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { orderedKeyDates } from "./domain/key-dates";
import { publishProblems, type PublishProblem } from "./domain/publish-rules";
import { competitionSlugCandidates } from "./domain/slug";
import {
  rescheduledJobs,
  upcomingChange,
  type UpcomingChange,
} from "./domain/status-schedule";
import type { CompetitionStatus } from "./domain/vocabulary";
import {
  DEFAULT_FIELDS,
  fieldsOf,
  parseFields,
  type CompetitionFields,
  type CompetitionInput,
  type CompetitionValues,
  type FieldsRefusal,
  type FieldsToSave,
} from "./fields";
import { saveStatusJobs } from "./status-jobs";
import {
  columnsOf,
  loadCompetition,
  replaceAgeGroups,
  replaceKeyDates,
} from "./store";
import { hasRefusedMove } from "./transition-guards";

/** What the competition use cases use: the database, the clock and the actor. */
export type CompetitionsContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor"
>;

/** The competition a manager acts on, as the policy sees it. */
export function competitionResource(competitionId: unknown): Resource {
  return typeof competitionId === "string"
    ? { scopes: [{ type: "competition", id: competitionId }] }
    : {};
}

/** Any well-formed UUID; Postgres refuses anything else as an id. */
const competitionIdSchema = z.guid();

export function isCompetitionId(value: unknown): value is string {
  return competitionIdSchema.safeParse(value).success;
}

export type CompetitionSummary = {
  id: string;
  code: string;
  slug: string;
  status: CompetitionStatus;
};

export type CreateCompetitionResult =
  | { ok: true; competition: CompetitionSummary }
  | FieldsRefusal
  | { ok: false; error: "code_taken" };

/** Whether `error` is a unique violation of the competition code. */
function isCodeTaken(error: unknown): boolean {
  if (sqlState(error) !== "23505") return false;
  let current = error;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "object" || current === null) return false;
    // PGlite's errors name it `constraint`, postgres-js's `constraint_name`.
    const record = current as Record<string, unknown>;
    const name = record.constraint ?? record.constraint_name;
    if (name === "competition_code_unique") return true;
    current = record.cause;
  }
  return false;
}

/** Whether another competition already has this code. */
async function codeTaken(
  db: AppDb,
  code: string,
  exceptId?: string
): Promise<boolean> {
  const rows = await db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.code, code));
  return rows.some((row) => row.id !== exceptId);
}

/**
 * The audit log's view of a competition: its values, key dates as ISO
 * instants in timeline order, so two views compare field by field.
 */
function auditView(values: CompetitionValues): Record<string, unknown> {
  const keyDates = Object.fromEntries(
    orderedKeyDates(values.keyDates).map(({ kind, at }) => [
      kind,
      at.toISOString(),
    ])
  );
  return { ...values, keyDates };
}

/** The fields whose values differ, with their values before and after. */
function changes(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changed = Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
  );
  return {
    before: Object.fromEntries(changed.map((key) => [key, before[key]])),
    after: Object.fromEntries(changed.map((key) => [key, after[key]])),
  };
}

/** Slugs to try after the name's own: the name with the code, then numbered. */
function slugCandidates(values: CompetitionValues): string[] {
  const candidates = competitionSlugCandidates(values.name, values.code);
  const last = candidates.at(-1)!;
  for (let n = 2; n <= 9; n++) candidates.push(`${last.slice(0, 77)}-${n}`);
  return candidates;
}

/**
 * Saves a new draft. It needs a code and a name; everything else may wait
 * until publishing. The slug comes from the name and is kept from then on.
 */
export async function createCompetition(
  ctx: CompetitionsContext,
  input: CompetitionInput
): Promise<CreateCompetitionResult> {
  const { role: actorRole } = await authorize(ctx, "competition.create");
  const parsed = parseFields({
    ...DEFAULT_FIELDS,
    ...withoutUndefined(input),
    code: input.code,
    name: input.name,
  });
  if (!parsed.ok) return parsed;
  const { values } = parsed;
  if (await codeTaken(ctx.db, values.code)) {
    return { ok: false, error: "code_taken" };
  }
  const now = ctx.clock.now();
  const id = uuidv7(now);

  try {
    return await ctx.db.transaction(async (tx) => {
      let slug: string | undefined;
      for (const candidate of slugCandidates(values)) {
        const [inserted] = await tx
          .insert(competition)
          .values({
            id,
            slug: candidate,
            ...columnsOf(values),
            status: "draft",
            createdByUserId:
              ctx.actor.kind === "user" ? ctx.actor.userId : null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: competition.slug })
          .returning({ slug: competition.slug });
        if (inserted) {
          slug = inserted.slug;
          break;
        }
      }
      if (slug === undefined) throw new Error("No free slug for the name");
      await replaceAgeGroups(tx, id, values, now);
      await replaceKeyDates(tx, id, values.keyDates);
      await recordAudit(tx, ctx, {
        action: "competition.created",
        entity: { type: "competition", id },
        before: null,
        after: { ...auditView(values), slug, status: "draft" },
        actorRole,
      });
      return {
        ok: true,
        competition: { id, code: values.code, slug, status: "draft" },
      } as const;
    });
  } catch (error) {
    // Another manager took the code since the check above.
    if (isCodeTaken(error)) return { ok: false, error: "code_taken" };
    throw error;
  }
}

/** A competition as the admin form opens it. */
export type CompetitionForEdit = {
  id: string;
  slug: string;
  status: CompetitionStatus;
  publishedAt: Date | null;
  fields: CompetitionFields;
  /** The schedule's next move, for the countdown under the status (#71). */
  nextChange: UpcomingChange;
  /** Whether the reader may cancel it (#80): a super admin, until it is. */
  mayCancel: boolean;
};

export type GetCompetitionForEditResult =
  | { ok: true; competition: CompetitionForEdit }
  | { ok: false; error: "not_found" };

/** The competition's every field, for the edit form. */
export async function getCompetitionForEdit(
  ctx: CompetitionsContext,
  input: { competitionId: string }
): Promise<GetCompetitionForEditResult> {
  await authorize(
    ctx,
    "competition.edit",
    competitionResource(input.competitionId)
  );
  if (!isCompetitionId(input.competitionId)) {
    return { ok: false, error: "not_found" };
  }
  const stored = await loadCompetition(ctx.db, input.competitionId);
  if (!stored) return { ok: false, error: "not_found" };
  const { row, values } = stored;
  const mayCancel =
    row.status !== "cancelled" &&
    (
      await can(
        ctx,
        "competition.cancel.read",
        competitionResource(input.competitionId)
      )
    ).allowed;
  return {
    ok: true,
    competition: {
      id: row.id,
      slug: row.slug,
      status: row.status,
      publishedAt: row.publishedAt,
      fields: fieldsOf(values),
      nextChange: upcomingChange(row.status, values.keyDates, ctx.clock.now()),
      mayCancel,
    },
  };
}

export type UpdateCompetitionInput = {
  competitionId: string;
} & Partial<CompetitionFields>;

export type UpdateCompetitionResult =
  | { ok: true; changed: boolean }
  | FieldsRefusal
  | { ok: false; error: "code_taken" | "code_locked" | "not_found" }
  | { ok: false; error: "not_ready"; problems: PublishProblem[] };

/**
 * Saves changes to a competition: the fields given, the others as they
 * were. Age groups, categories and key dates are replaced whole when
 * given. New disciplines or age groups without categories make every
 * pairing a category. Changing nothing records nothing (`changed: false`).
 *
 * Once published, a competition keeps its code (registration numbers are
 * made from it: `code_locked`) and must stay publishable (`not_ready`),
 * and each key date added or moved gets a status job for its new instant
 * (#71); the jobs of the old instants do nothing when they run. Changing
 * the disciplines while a move is refused tries the move again (#88):
 * the school-judging guard checks them.
 */
export async function updateCompetition(
  ctx: CompetitionsContext,
  input: UpdateCompetitionInput
): Promise<UpdateCompetitionResult> {
  const { competitionId, ...given } = input;
  const { role: actorRole } = await authorize(
    ctx,
    "competition.edit",
    competitionResource(competitionId)
  );
  if (!isCompetitionId(competitionId)) {
    return { ok: false, error: "not_found" };
  }
  const now = ctx.clock.now();

  try {
    return await ctx.db.transaction(async (tx) => {
      const stored = await loadCompetition(tx, competitionId, { lock: true });
      if (!stored) return { ok: false, error: "not_found" } as const;
      const given_ = withoutUndefined(given);
      const merged: FieldsToSave = { ...fieldsOf(stored.values), ...given_ };
      const regroup =
        given_.categories === undefined &&
        (given_.disciplines !== undefined || given_.ageGroups !== undefined);
      if (regroup) delete merged.categories;
      const parsed = parseFields(merged);
      if (!parsed.ok) return parsed;
      const { values } = parsed;
      if (stored.row.status !== "draft") {
        if (values.code !== stored.values.code) {
          return { ok: false, error: "code_locked" } as const;
        }
        const problems = publishProblems(values);
        if (problems.length > 0) {
          return { ok: false, error: "not_ready", problems } as const;
        }
      }
      if (await codeTaken(tx, values.code, competitionId)) {
        return { ok: false, error: "code_taken" } as const;
      }

      const diff = changes(auditView(stored.values), auditView(values));
      const changed = Object.keys(diff.after);
      if (changed.length === 0) return { ok: true, changed: false } as const;

      await tx
        .update(competition)
        .set({ ...columnsOf(values), updatedAt: now })
        .where(eq(competition.id, competitionId));
      // Only a change to them replaces the rows, so the categories keep
      // their ids through other edits.
      if (changed.includes("ageGroups") || changed.includes("categories")) {
        await replaceAgeGroups(tx, competitionId, values, now);
      }
      if (changed.includes("keyDates")) {
        await replaceKeyDates(tx, competitionId, values.keyDates);
        await saveStatusJobs(
          tx,
          ctx.clock,
          competitionId,
          rescheduledJobs(
            stored.row.status,
            stored.values.keyDates,
            values.keyDates
          )
        );
        // Its reminders follow the new dates (#84); a draft has none yet.
        if (stored.row.status !== "draft") {
          await emit(tx, ctx.clock, {
            type: "competition.key_dates_changed",
            aggregate: { type: "competition", id: competitionId },
            payload: { competitionId },
          });
        }
      }
      if (
        changed.includes("disciplines") &&
        (await hasRefusedMove(tx, competitionId))
      ) {
        await emit(tx, ctx.clock, {
          type: "competition.disciplines_changed",
          aggregate: { type: "competition", id: competitionId },
          payload: { competitionId },
        });
      }
      await recordAudit(tx, ctx, {
        action: "competition.updated",
        entity: { type: "competition", id: competitionId },
        ...diff,
        actorRole,
      });
      return { ok: true, changed: true } as const;
    });
  } catch (error) {
    if (isCodeTaken(error)) return { ok: false, error: "code_taken" };
    throw error;
  }
}

/** A row of the admin area's competition list. */
export type AdminCompetitionListItem = {
  id: string;
  code: string;
  slug: string;
  name: string;
  status: CompetitionStatus;
  publishedAt: Date | null;
  updatedAt: Date;
};

/**
 * The competitions the actor manages, the latest change first: every one
 * for a global competition manager, else those their grants name.
 */
export async function listCompetitionsForAdmin(
  ctx: CompetitionsContext
): Promise<AdminCompetitionListItem[]> {
  await authorize(ctx, "competition.list");
  if (ctx.actor.kind !== "user") return [];
  const grants = (await grantsOf(ctx.db, ctx.actor.userId)).filter(
    (grant) => grant.role === "competition_manager"
  );
  const global = grants.some((grant) => grant.scope.type === "global");
  const ids = grants.flatMap((grant) =>
    grant.scope.type === "competition" ? [grant.scope.id] : []
  );
  if (!global && ids.length === 0) return [];
  return adminCompetitionRows(ctx.db, global ? undefined : ids);
}

/** Super admins can find a competition to cancel without management rights. */
export async function listCompetitionsForCancellation(
  ctx: CompetitionsContext
): Promise<AdminCompetitionListItem[]> {
  await authorize(ctx, "competition.cancel.read");
  return adminCompetitionRows(ctx.db);
}

function adminCompetitionRows(db: AppDb, ids?: string[]) {
  return db
    .select({
      id: competition.id,
      code: competition.code,
      slug: competition.slug,
      name: competition.name,
      status: competition.status,
      publishedAt: competition.publishedAt,
      updatedAt: competition.updatedAt,
    })
    .from(competition)
    .where(ids ? inArray(competition.id, ids) : undefined)
    .orderBy(desc(competition.updatedAt), desc(competition.id));
}

/** `input` without the keys whose value is undefined. */
export function withoutUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}
