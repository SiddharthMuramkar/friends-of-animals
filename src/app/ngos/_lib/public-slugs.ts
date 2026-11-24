import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";
import { memoisedSlugLookup } from "@/app/competitions/_lib/slug-lookup";

/**
 * src/proxy.ts's answer to "is this a verified listing?" (#127), from the
 * directory through a memo on this server instance (see
 * memoisedSlugLookup): a listing verified a moment ago shows within a
 * second, and a run of made-up slugs costs at most one query a second.
 * The app loads on the first directory request, so other requests through
 * the proxy never load the database layer.
 */
export const publicListingSlugLookup = memoisedSlugLookup({
  load: async () => {
    const { as } = await import("@/server/app");
    return as(PUBLIC_READER).publicListingSlugs();
  },
  now: () => Date.now(),
  ttlMs: 60_000,
  missRefreshMs: 1_000,
});
