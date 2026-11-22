// How long the public pages keep a cached read of published competitions.
// Publishing and editing refresh the reads at once through their cache
// tags, but the worker moves statuses on the schedule (#71) as plain Node,
// outside Next, so nothing refreshes the reads when it does. So a read
// lives no longer than the next automatic move among the competitions it
// holds: the first request after that instant serves it once more and
// refreshes it in the background (stale-while-revalidate). Once a move is
// due but the worker hasn't made it yet (it drains every few seconds), the
// read is checked again each minute.
//
// Pure: the cached reads pass the time they read at.

import type { PublicCompetition } from "@/server/modules/competitions";
import type { KeyDates } from "@/server/modules/competitions/domain/key-dates";
import { upcomingChange } from "@/server/modules/competitions/domain/status-schedule";

/** An inline cacheLife profile, in seconds. */
export type CacheLifeProfile = {
  stale: number;
  revalidate: number;
  expire: number;
};

/**
 * The "hours" profile, for a read with no move within the hour. `stale`
 * stays at 5 minutes and `expire` well over it, so the reads stay in the
 * App Shell and in prerenders (see the cacheLife docs).
 */
const HOURS: CacheLifeProfile = {
  stale: 300,
  revalidate: 3600,
  expire: 86_400,
};

/** The shortest life: how often a due move is checked for. */
const SHORTEST_S = 60;

/** Seconds from `now` to the next automatic move of `c`, or null. */
function secondsToNextMove(
  c: Pick<PublicCompetition, "status" | "keyDates">,
  now: Date
): number | null {
  const keyDates: KeyDates = {};
  for (const d of c.keyDates) keyDates[d.kind] = d.at;
  const change = upcomingChange(c.status, keyDates, now);
  if (!change) return null;
  // Rounded up, so the refresh never comes before the instant.
  return Math.ceil((change.at.getTime() - now.getTime()) / 1000);
}

/**
 * The cache life for a read of `competitions` made at `now`: the "hours"
 * profile, with `revalidate` cut to the next automatic move among them,
 * but never under a minute.
 */
export function publicCacheLife(
  competitions: readonly Pick<PublicCompetition, "status" | "keyDates">[],
  now: Date
): CacheLifeProfile {
  let revalidate = HOURS.revalidate;
  for (const c of competitions) {
    const seconds = secondsToNextMove(c, now);
    if (seconds !== null) {
      revalidate = Math.min(revalidate, Math.max(SHORTEST_S, seconds));
    }
  }
  return { ...HOURS, revalidate };
}
