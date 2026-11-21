// Creating and opening competitions in the admin area (#70).
//
//   createCompetition({ code, name, ... })      → a global competition manager
//   getCompetitionForEdit({ competitionId })    → a manager covering it
//
// Expected refusals come back as results; an actor the policy refuses gets
// DomainError("forbidden"). Loads under plain Node: relative imports only.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { Resource } from "../../access/domain/policy";
import { recordAudit } from "../../audit/record";
import { competition } from "../../db/schema";
import { sqlState } from "../../errors";
import { uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import { competitionSlugCandidates } from "./domain/slug";
import type { CompetitionStatus } from "./domain/vocabulary";
import {
  DEFAULT_FIELDS,
  fieldsOf,
  parseFields,
  type CompetitionFields,
  type CompetitionInput,
  type CompetitionValues,
  type FieldsRefusal,
} from "./fields";
import { columnsOf, loadCompetition, replaceGroups } from "./store";

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
  ctx: CompetitionsContext,
  code: string,
  exceptId?: string
): Promise<boolean> {
  const rows = await ctx.db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.code, code));
  return rows.some((row) => row.id !== exceptId);
}

/** The audit log's view of a competition: its values, dates as instants. */
function auditView(values: CompetitionValues) {
  return { ...values };
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
  if (await codeTaken(ctx, values.code)) {
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
      await replaceGroups(tx, id, values, now);
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
  return {
    ok: true,
    competition: {
      id: row.id,
      slug: row.slug,
      status: row.status,
      publishedAt: row.publishedAt,
      fields: fieldsOf(values),
    },
  };
}

/** `input` without the keys whose value is undefined. */
export function withoutUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}
