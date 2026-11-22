// The public read model (#70): published competitions for the public
// pages and the proxy's slug check. Anyone may read it; a draft is never
// in it. Loads under plain Node: relative imports only.

import { and, asc, eq, ne } from "drizzle-orm";

import { authorize } from "../../access/can";
import { competition } from "../../db/schema";
import { COMPETITION_SLUG_PATTERN } from "./domain/slug";
import type { CompetitionsContext } from "./manage";
import { toPublicCompetition, type PublicCompetition } from "./public-view";
import { withValues, type StoredCompetition } from "./store";

const isPublished = ne(competition.status, "draft");

function publicViews(
  stored: readonly StoredCompetition[]
): PublicCompetition[] {
  return stored.flatMap(({ row, values }) => {
    if (row.status === "draft" || row.publishedAt === null) return [];
    const view = toPublicCompetition(
      {
        id: row.id,
        slug: row.slug,
        status: row.status,
        publishedAt: row.publishedAt,
      },
      values
    );
    return view ? [view] : [];
  });
}

const opens = (view: PublicCompetition) =>
  view.keyDates
    .find((date) => date.kind === "registration_opens")
    ?.at.getTime() ?? Number.POSITIVE_INFINITY;

/** Every published competition, the one whose registration opens first first. */
export async function listPublishedCompetitions(
  ctx: CompetitionsContext
): Promise<PublicCompetition[]> {
  await authorize(ctx, "competition.read_published");
  const rows = await ctx.db.select().from(competition).where(isPublished);
  return publicViews(await withValues(ctx.db, rows)).sort(
    (a, b) => opens(a) - opens(b) || a.name.localeCompare(b.name, "en-IN")
  );
}

/** The published competition at /competitions/<slug>, or null. */
export async function getPublishedCompetition(
  ctx: CompetitionsContext,
  input: { slug: string }
): Promise<PublicCompetition | null> {
  await authorize(ctx, "competition.read_published");
  if (!COMPETITION_SLUG_PATTERN.test(input.slug)) return null;
  const rows = await ctx.db
    .select()
    .from(competition)
    .where(and(eq(competition.slug, input.slug), isPublished));
  const [view] = publicViews(await withValues(ctx.db, rows));
  return view ?? null;
}

/** The slugs of every published competition, in order. */
export async function publishedCompetitionSlugs(
  ctx: CompetitionsContext
): Promise<string[]> {
  await authorize(ctx, "competition.read_published");
  const rows = await ctx.db
    .select({ slug: competition.slug })
    .from(competition)
    .where(isPublished)
    .orderBy(asc(competition.slug));
  return rows.map((row) => row.slug);
}
