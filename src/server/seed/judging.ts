// Judging seed data (#88): rubrics on the competitions seed, in every
// state a preview needs. NEIGH27 has every discipline published, so its
// school judging can start on time; WATER27's essay rubric is only a
// draft, so its school-judging flip is blocked; SKIES26's drawing rubric
// was revised twice (version 1 replaced, version 2 in force, version 3 a
// draft). Rubrics follow the competitions seed: a competition it no
// longer has gets none. Loads under plain Node (the seed script):
// relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import { competition, rubric, rubricCriterion } from "../db/schema";
import { uuidv7 } from "../ids";
import type { Discipline } from "../modules/competitions/domain/vocabulary";
import {
  defaultRubricCriteria,
  type RubricCriterion,
} from "../modules/judging/domain/rubric-criteria";
import type { SeedDeps } from "./types";

type SeedRubric = {
  id: string;
  competitionCode: string;
  discipline: Discipline;
  version: number;
  /** Published once; a later published version then supersedes it. */
  published: boolean;
  criteria: () => RubricCriterion[];
};

/** Version 2 of SKIES26's drawing rubric: theme counts for more. */
function themeFirst(): RubricCriterion[] {
  const [theme, creativity, technique, presentation] = defaultRubricCriteria();
  return [
    { ...theme!, weight: 40, description: "Shows kindness to birds." },
    { ...creativity!, weight: 25 },
    { ...technique!, weight: 20 },
    { ...presentation!, weight: 15 },
  ];
}

/** The draft of version 3: three criteria, weights not yet settled. */
function threeParts(): RubricCriterion[] {
  return themeFirst()
    .slice(0, 3)
    .map((criterion) => ({ ...criterion, maxScore: 5 }));
}

const id = (n: number) =>
  `01938a00-0000-7000-8000-0000000088${String(n).padStart(2, "0")}`;

/** In order: a revision comes after the version it replaces. */
const SEED_RUBRICS: readonly SeedRubric[] = [
  ...(["drawing", "painting", "photography"] as const).map(
    (discipline, index) => ({
      id: id(1 + index),
      competitionCode: "NEIGH27",
      discipline,
      version: 1,
      published: true,
      criteria: defaultRubricCriteria,
    })
  ),
  {
    id: id(11),
    competitionCode: "WATER27",
    discipline: "drawing",
    version: 1,
    published: true,
    criteria: defaultRubricCriteria,
  },
  {
    id: id(12),
    competitionCode: "WATER27",
    discipline: "essay",
    version: 1,
    published: false,
    criteria: defaultRubricCriteria,
  },
  {
    id: id(21),
    competitionCode: "SKIES26",
    discipline: "drawing",
    version: 1,
    published: true,
    criteria: defaultRubricCriteria,
  },
  {
    id: id(22),
    competitionCode: "SKIES26",
    discipline: "drawing",
    version: 2,
    published: true,
    criteria: themeFirst,
  },
  {
    id: id(23),
    competitionCode: "SKIES26",
    discipline: "drawing",
    version: 3,
    published: false,
    criteria: threeParts,
  },
  ...(["painting", "craft"] as const).map((discipline, index) => ({
    id: id(24 + index),
    competitionCode: "SKIES26",
    discipline,
    version: 1,
    published: true,
    criteria: defaultRubricCriteria,
  })),
];

async function competitionIdsByCode(db: AppDb): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: competition.id, code: competition.code })
    .from(competition);
  return new Map(rows.map((row) => [row.code, row.id]));
}

/**
 * Writes one rubric the way the use cases do: a draft with its criteria
 * first (the trigger refuses criteria for anything else), then, if it was
 * published, it replaces the discipline's published version.
 */
async function insertRubric(
  { db, clock }: SeedDeps,
  competitionId: string,
  seed: SeedRubric
): Promise<void> {
  const now = clock.now();
  const [inserted] = await db
    .insert(rubric)
    .values({
      id: seed.id,
      competitionId,
      discipline: seed.discipline,
      version: seed.version,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: rubric.id });
  if (!inserted) return;
  await db.insert(rubricCriterion).values(
    seed.criteria().map((criterion, position) => ({
      id: uuidv7(now),
      rubricId: seed.id,
      position,
      ...criterion,
    }))
  );
  if (!seed.published) return;
  await db
    .update(rubric)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(rubric.competitionId, competitionId),
        eq(rubric.discipline, seed.discipline),
        eq(rubric.status, "published")
      )
    );
  await db
    .update(rubric)
    .set({ status: "published", publishedAt: now, updatedAt: now })
    .where(eq(rubric.id, seed.id));
}

/** The rubrics above. Running again changes nothing. */
export async function seedJudging(deps: SeedDeps): Promise<void> {
  const competitions = await competitionIdsByCode(deps.db);
  for (const seed of SEED_RUBRICS) {
    const competitionId = competitions.get(seed.competitionCode);
    if (competitionId) await insertRubric(deps, competitionId, seed);
  }
}
