// What the public reads of the directory (#127): one verified listing by
// its slug, and the slugs of every verified listing (src/proxy.ts answers
// any other /ngos/<slug> with a real 404). Search by service and distance
// is #128's, over the same read model (./domain/public-listing.ts).

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { directoryListing } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { toPublicListing, type PublicListing } from "./domain/public-listing";
import { storedListingOf } from "./stored-listing";

export type GetPublicListingResult =
  | { ok: true; listing: PublicListing }
  | { ok: false; error: "not_found" };

const slugInput = z.object({ slug: z.string().min(1).max(100) });

/** The verified listing with this slug; anything else is not found. */
export async function getPublicListing(
  ctx: UseCaseContext,
  input: { slug: string }
): Promise<GetPublicListingResult> {
  await authorize(ctx, "directory.read_public");
  const parsed = slugInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const [row] = await ctx.db
    .select()
    .from(directoryListing)
    .where(
      and(
        eq(directoryListing.slug, parsed.data.slug),
        eq(directoryListing.status, "verified")
      )
    );
  const listing = row ? toPublicListing(storedListingOf(ctx, row)) : null;
  return listing ? { ok: true, listing } : { ok: false, error: "not_found" };
}

/** Every verified listing's slug, for the proxy's 404s. */
export async function publicListingSlugs(
  ctx: UseCaseContext
): Promise<string[]> {
  await authorize(ctx, "directory.read_public");
  const rows = await ctx.db
    .select({ slug: directoryListing.slug })
    .from(directoryListing)
    .where(eq(directoryListing.status, "verified"))
    .orderBy(asc(directoryListing.slug));
  return rows.map((row) => row.slug);
}
