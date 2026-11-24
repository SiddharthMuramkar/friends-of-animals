import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";
import { as } from "@/server/app";
import { DIRECTORY_TAGS, type PublicListing } from "@/server/modules/directory";
import { isListingSlug } from "@/server/modules/directory/domain/slug";

// The public listing page's read (#127). It is cached and tagged, so a
// staff decision, an edit or a withdrawal refreshes it with updateTag()
// from its Server Action, without a deploy. Nothing else changes a
// listing, so a read can live for hours.

/** The build's stand-in slug: no listing can have it. */
export const PLACEHOLDER_SLUG = "__placeholder__";

/** The verified listing with this slug, or null. */
export async function publicListing(
  slug: string
): Promise<PublicListing | null> {
  "use cache";
  // The build's placeholder, or anything else that can't be a slug.
  if (!isListingSlug(slug)) return null;
  cacheTag(DIRECTORY_TAGS.listing(slug));
  cacheLife("hours");
  const result = await as(PUBLIC_READER).getPublicListing({ slug });
  return result.ok ? result.listing : null;
}
