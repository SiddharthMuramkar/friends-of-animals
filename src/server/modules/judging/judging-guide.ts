// The judging guide (#88): what coordinators of registered institutions
// read before their school round opens. FOA's judging framework is copy
// on the page (messages/en-IN/judgingGuide.json); this is the rest, the
// published rubric of each discipline a competition runs. Drafts and
// replaced versions are never shown.
//
//   getJudgingGuide({ code })  → each discipline's published rubric
//   listJudgingGuides()        → the competitions with a guide, for the dashboard
//
// Registered, until registration for a competition exists (#75): FOA has
// verified the institution (#73). Then the guide narrows to the
// competitions the institution registered for (HR-37).

import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { Resource } from "../../access/domain/policy";
import type { Role } from "../../access/domain/roles";
import { grantsOf } from "../../access/grants";
import { competition, institution, rubric } from "../../db/schema";
import {
  schoolsTakePart,
  type CompetitionStatus,
  type Discipline,
} from "../competitions/domain/vocabulary";
import type { RubricCriterion } from "./domain/rubric-criteria";
import { criteriaOf, type RubricContext } from "./rubrics";

/** A competition with a judging guide, as coordinators see it. */
export type GuideCompetition = {
  code: string;
  name: string;
  status: CompetitionStatus;
};

export type JudgingGuideDiscipline = {
  discipline: Discipline;
  /** The published rubric; null until the discipline has one. */
  rubric: {
    version: number;
    publishedAt: Date;
    criteria: RubricCriterion[];
  } | null;
};

export type GetJudgingGuideResult =
  | {
      ok: true;
      competition: GuideCompetition;
      /** One entry per discipline the competition runs, in its order. */
      disciplines: JudgingGuideDiscipline[];
    }
  | { ok: false; error: "not_found" };

/** The roles that act for an institution in a competition. */
const COORDINATING: readonly Role[] = [
  "institution_admin",
  "institution_coordinator",
];

/**
 * The scopes a guide sits in for this actor: the institutions they act
 * for that are registered (verified by FOA). None for anyone else.
 */
async function registeredInstitutionScopes(
  ctx: RubricContext
): Promise<Resource> {
  if (ctx.actor.kind !== "user") return {};
  const ids = (await grantsOf(ctx.db, ctx.actor.userId)).flatMap(
    ({ role, scope }) =>
      COORDINATING.includes(role) && scope.type === "institution"
        ? [scope.id]
        : []
  );
  if (ids.length === 0) return {};
  const rows = await ctx.db
    .select({ id: institution.id })
    .from(institution)
    .where(
      and(inArray(institution.id, ids), eq(institution.status, "verified"))
    );
  return {
    scopes: rows.map((row) => ({ type: "institution" as const, id: row.id })),
  };
}

/** Published, and with a school round: the competitions with a guide. */
const hasGuide = and(
  isNotNull(competition.publishedAt),
  ne(competition.participation, "individuals")
);

const codeInput = z.object({ code: z.string().trim().min(1).max(32) });

/** One competition's judging guide, by its code. */
export async function getJudgingGuide(
  ctx: RubricContext,
  input: { code: string }
): Promise<GetJudgingGuideResult> {
  await authorize(
    ctx,
    "judgingGuide.read",
    await registeredInstitutionScopes(ctx)
  );
  const parsed = codeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const [found] = await ctx.db
    .select({
      id: competition.id,
      code: competition.code,
      name: competition.name,
      status: competition.status,
      participation: competition.participation,
      disciplines: competition.disciplines,
    })
    .from(competition)
    .where(and(eq(competition.code, parsed.data.code), hasGuide));
  if (
    !found ||
    found.participation === null ||
    !schoolsTakePart(found.participation)
  ) {
    return { ok: false, error: "not_found" };
  }

  const published = await ctx.db
    .select({
      id: rubric.id,
      discipline: rubric.discipline,
      version: rubric.version,
      publishedAt: rubric.publishedAt,
    })
    .from(rubric)
    .where(
      and(eq(rubric.competitionId, found.id), eq(rubric.status, "published"))
    );
  const criteria = await criteriaOf(
    ctx.db,
    published.map((row) => row.id)
  );
  return {
    ok: true,
    competition: { code: found.code, name: found.name, status: found.status },
    disciplines: found.disciplines.map((discipline) => {
      const row = published.find((r) => r.discipline === discipline);
      return {
        discipline,
        rubric:
          row && row.publishedAt
            ? {
                version: row.version,
                publishedAt: row.publishedAt,
                criteria: criteria.get(row.id) ?? [],
              }
            : null,
      };
    }),
  };
}

/** The competitions whose guide the actor may read, by name. */
export async function listJudgingGuides(
  ctx: RubricContext
): Promise<GuideCompetition[]> {
  await authorize(
    ctx,
    "judgingGuide.read",
    await registeredInstitutionScopes(ctx)
  );
  return ctx.db
    .select({
      code: competition.code,
      name: competition.name,
      status: competition.status,
    })
    .from(competition)
    .where(hasGuide)
    .orderBy(asc(competition.name), asc(competition.code));
}
