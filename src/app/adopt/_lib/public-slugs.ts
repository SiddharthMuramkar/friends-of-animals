import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";
import { memoisedSlugLookup } from "@/app/competitions/_lib/slug-lookup";

/**
 * src/proxy.ts's answer to "has this animal a public page?" (#129), from
 * the adoption module through a memo on this server instance (see
 * memoisedSlugLookup): an animal published a moment ago shows within a
 * second, and a run of made-up slugs costs at most one query a second.
 */
export const adoptableSlugLookup = memoisedSlugLookup({
  load: async () => {
    const { as } = await import("@/server/app");
    return as(PUBLIC_READER).adoptableAnimalSlugs();
  },
  now: () => Date.now(),
  ttlMs: 60_000,
  missRefreshMs: 1_000,
});
