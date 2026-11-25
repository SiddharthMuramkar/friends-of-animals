import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";
import { as } from "@/server/app";
import {
  ADOPTION_TAGS,
  type AdoptableAnimal,
  type BrowseAdoptableAnimalsResult,
} from "@/server/modules/adoption";
import type { PublishedSuccessStory } from "@/server/modules/adoption/applications";
import { ADOPTION_SLUG_PATTERN } from "@/server/modules/adoption/domain/slug";
import {
  parseAdoptionFilters,
  type SearchParamsRecord,
} from "@/server/modules/adoption/domain/filters";
import { DIRECTORY_TAGS } from "@/server/modules/directory";

// The public adoption pages' reads (#129), cached and tagged. A
// representative's change refreshes `adoption` and the animal's own tag
// from its Server Action; each read also carries its organisations'
// directory tags, so suspending one (#127) drops its animals at once.
// Ages move with the months, so nothing lives longer than a quarter of an
// hour.
const LIFE = { stale: 60, revalidate: 300, expire: 900 } as const;

/** The build's stand-in slug: no animal can have it. */
export const PLACEHOLDER_SLUG = "__placeholder__";

/**
 * One browse page, keyed on the canonical query string (filters in one
 * order, unknown ones dropped) and the cursor.
 */
export async function browsePage(
  query: string,
  cursor: string | null
): Promise<BrowseAdoptableAnimalsResult> {
  "use cache";
  cacheLife(LIFE);
  cacheTag(ADOPTION_TAGS.all);
  const filters = parseAdoptionFilters(
    Object.fromEntries(new URLSearchParams(query)) as SearchParamsRecord
  );
  const page = await as(PUBLIC_READER).browseAdoptableAnimals({
    filters,
    cursor,
  });
  for (const slug of new Set(page.animals.map((a) => a.organisation.slug))) {
    cacheTag(DIRECTORY_TAGS.listing(slug));
  }
  return page;
}

/** The animal with this slug while its page is public, or null. */
export async function adoptableAnimal(
  slug: string
): Promise<AdoptableAnimal | null> {
  "use cache";
  if (!ADOPTION_SLUG_PATTERN.test(slug)) return null;
  cacheLife(LIFE);
  cacheTag(ADOPTION_TAGS.animal(slug));
  const result = await as(PUBLIC_READER).getAdoptableAnimal({ slug });
  if (!result.ok) return null;
  cacheTag(DIRECTORY_TAGS.listing(result.animal.organisation.slug));
  return result.animal;
}

/**
 * The published success stories (#130), newest first. Publishing or
 * withdrawing one refreshes the stories tag; suspending an organisation
 * refreshes its directory tag, which drops its stories.
 */
export async function publishedStories(): Promise<PublishedSuccessStory[]> {
  "use cache";
  cacheLife(LIFE);
  cacheTag(ADOPTION_TAGS.stories);
  const stories = await as(PUBLIC_READER).listPublishedSuccessStories();
  for (const slug of new Set(stories.map((s) => s.organisation.slug))) {
    cacheTag(DIRECTORY_TAGS.listing(slug));
  }
  return stories;
}
