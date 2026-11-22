import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import {
  type CompetitionView,
  fromPublic,
} from "@/components/competitions/model";
import { as } from "@/server/app";
import { COMPETITION_TAGS } from "@/server/modules/competitions";
import { COMPETITION_SLUG_PATTERN } from "@/server/modules/competitions/domain/slug";

import { publicCacheLife } from "./cache-life";
import { PUBLIC_READER } from "./public-reader";

// The public pages' reads of published competitions. Each is cached and
// tagged, so the admin's publish and edit actions refresh the pages with
// updateTag(), without a deploy. The worker's status moves (#71) can't call
// updateTag, so each read lives only until the next move among the
// competitions it holds (see cache-life.ts). Neither runs while the app is
// built: the list page reads after connection(), and the detail route
// lists only a placeholder, which never reaches the database.

/** Every published competition, soonest first, as the list shows them. */
export async function publishedCompetitions(): Promise<CompetitionView[]> {
  "use cache";
  cacheTag(COMPETITION_TAGS.list);
  const list = await as(PUBLIC_READER).listPublishedCompetitions();
  cacheLife(publicCacheLife(list, new Date()));
  return list.map(fromPublic);
}

/** The published competition with this slug, or null. */
export async function publishedCompetition(
  slug: string
): Promise<CompetitionView | null> {
  "use cache";
  // The build's placeholder, or anything else that can't be a slug.
  if (!COMPETITION_SLUG_PATTERN.test(slug)) return null;
  cacheTag(COMPETITION_TAGS.list, COMPETITION_TAGS.slug(slug));
  const competition = await as(PUBLIC_READER).getPublishedCompetition({
    slug,
  });
  cacheLife(publicCacheLife(competition ? [competition] : [], new Date()));
  return competition ? fromPublic(competition) : null;
}
