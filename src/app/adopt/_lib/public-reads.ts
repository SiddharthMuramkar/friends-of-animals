import "server-only";

import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";
import { as } from "@/server/app";
import {
  type AdoptableAnimal,
  type BrowseAdoptableAnimalsResult,
} from "@/server/modules/adoption";
import type { PublishedSuccessStory } from "@/server/modules/adoption/applications";
import { ADOPTION_SLUG_PATTERN } from "@/server/modules/adoption/domain/slug";
import {
  parseAdoptionFilters,
  type SearchParamsRecord,
} from "@/server/modules/adoption/domain/filters";

// Public adoption projections include the directory listing's details and
// eligibility. Privacy erasure changes these in the worker, outside Next's
// cache invalidation context. Read them fresh in the existing Suspense
// boundaries so a withdrawn listing's animals or stories cannot stay public.

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
  const filters = parseAdoptionFilters(
    Object.fromEntries(new URLSearchParams(query)) as SearchParamsRecord
  );
  return as(PUBLIC_READER).browseAdoptableAnimals({ filters, cursor });
}

/** The animal with this slug while its page is public, or null. */
export async function adoptableAnimal(
  slug: string
): Promise<AdoptableAnimal | null> {
  if (!ADOPTION_SLUG_PATTERN.test(slug)) return null;
  const result = await as(PUBLIC_READER).getAdoptableAnimal({ slug });
  if (!result.ok) return null;
  return result.animal;
}

/** The published success stories (#130), newest first. */
export async function publishedStories(): Promise<PublishedSuccessStory[]> {
  return as(PUBLIC_READER).listPublishedSuccessStories();
}
