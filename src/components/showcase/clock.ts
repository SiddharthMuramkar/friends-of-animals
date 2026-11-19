import { cacheLife } from "next/cache";

/**
 * "Now" for server components. Reading the clock while prerendering needs a
 * cache boundary under Cache Components (as in site-footer.tsx).
 *
 * Deadline-driven text (the announcement bar, key dates, the timeline's
 * "Done" marks, this month's tip) reads it, so pages regenerate every 5
 * minutes and a passed deadline shows within that. `stale` stays at 5
 * minutes, since under that the text drops out of the App Shell, and
 * `expire` stays well over 5 minutes so the pages still prerender (see the
 * cacheLife docs). The footer's year keeps its own daily cache.
 */
export async function cachedNow(): Promise<number> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 3600 });
  return Date.now();
}
