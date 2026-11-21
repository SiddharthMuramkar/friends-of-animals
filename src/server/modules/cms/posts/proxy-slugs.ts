// The published post slugs src/proxy.ts checks /blog/<slug> against, read
// at most once a minute per server instance (./slug-gate.ts).

import { STORY_SLUGS } from "@/content/stories";

import { createSlugGate } from "./slug-gate";

const ONE_MINUTE = 60_000;

export const publishedPostSlugs = createSlugGate({
  ttlMs: ONE_MINUTE,
  load: async () => STORY_SLUGS,
});
