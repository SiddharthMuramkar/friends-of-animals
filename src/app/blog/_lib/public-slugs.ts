import { memoisedSlugLookup } from "@/app/competitions/_lib/slug-lookup";
import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";

/**
 * src/proxy.ts's answer to "is this post public?" (#112), from the CMS
 * through a memo on this server instance (see memoisedSlugLookup): a post
 * published or due a moment ago shows within a second, and a run of
 * made-up slugs costs at most one query a second. The app loads on the
 * first blog request, so other requests through the proxy never load the
 * database layer.
 */
export const publicPostSlugLookup = memoisedSlugLookup({
  load: async () => {
    const { as } = await import("@/server/app");
    return as(PUBLIC_READER).publishedPostSlugs();
  },
  now: () => Date.now(),
  ttlMs: 60_000,
  missRefreshMs: 1_000,
});
