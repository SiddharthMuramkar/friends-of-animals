import "server-only";

import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";
import { as } from "@/server/app";
import type { PublicListing } from "@/server/modules/directory";
import { isListingSlug } from "@/server/modules/directory/domain/slug";

// The public listing page's read (#127). Privacy erasure runs in the
// worker, which cannot invalidate Next.js cache tags. Read current data
// in the page's Suspense boundary so a withdrawn contact cannot be served
// from a previously cached public projection.

/** The build's stand-in slug: no listing can have it. */
export const PLACEHOLDER_SLUG = "__placeholder__";

/** The verified listing with this slug, or null. */
export async function publicListing(
  slug: string
): Promise<PublicListing | null> {
  // The build's placeholder, or anything else that can't be a slug.
  if (!isListingSlug(slug)) return null;
  const result = await as(PUBLIC_READER).getPublicListing({ slug });
  return result.ok ? result.listing : null;
}
