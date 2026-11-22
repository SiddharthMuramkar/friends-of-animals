// How long the public pages keep a cached read of posts. Hand edits refresh
// the reads at once through their cache tags (updateTag in the Server
// Action), but a scheduled post goes live at its instant, when nothing
// calls updateTag: publicPostFilter shows it from then, whether or not the
// worker's job has run. So a read lives no longer than the next scheduled
// instant: the first request after it serves the read once more and
// refreshes it in the background (stale-while-revalidate).
//
// Pure: the cached reads pass the instant they read at.

/** An inline cacheLife profile, in seconds. */
export type CacheLifeProfile = {
  stale: number;
  revalidate: number;
  expire: number;
};

/**
 * The "hours" profile. `stale` stays at 5 minutes and `expire` well over
 * it, so the reads stay in the App Shell and in prerenders (see the
 * cacheLife docs).
 */
const HOURS: CacheLifeProfile = {
  stale: 300,
  revalidate: 3600,
  expire: 86_400,
};

/** The shortest life: how often a due post is checked for. */
const SHORTEST_S = 60;

/**
 * The cache life of a read made at `now`, when the next scheduled post goes
 * live at `nextAt` (or none is scheduled).
 */
export function postsCacheLife(
  nextAt: Date | null,
  now: Date
): CacheLifeProfile {
  if (nextAt === null) return HOURS;
  const seconds = Math.ceil((nextAt.getTime() - now.getTime()) / 1000);
  return {
    ...HOURS,
    revalidate: Math.min(HOURS.revalidate, Math.max(SHORTEST_S, seconds)),
  };
}
