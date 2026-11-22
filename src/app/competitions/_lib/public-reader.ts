import type { Actor } from "@/server/actor";

import { memoisedSlugLookup } from "./slug-lookup";

/**
 * Who the public pages read published competitions as: a visitor with no
 * request behind it. Cached reads can't see a request's headers, and the
 * read model logs nothing about its caller.
 */
export const PUBLIC_READER: Actor = {
  kind: "visitor",
  meta: { ip: "unknown", userAgent: "" },
};

/**
 * src/proxy.ts's answer to "is this slug published?", from the database
 * through a memo on this server instance (see memoisedSlugLookup). The
 * app loads on the first competition request, so blog and account
 * requests through the proxy never load the database layer.
 */
export const publishedSlugLookup = memoisedSlugLookup({
  load: async () => {
    const { as } = await import("@/server/app");
    return as(PUBLIC_READER).publishedCompetitionSlugs();
  },
  now: () => Date.now(),
  ttlMs: 60_000,
  missRefreshMs: 1_000,
});
