// Worker health (#66): whether the VPS worker serving this database is
// alive, from its `worker_heartbeat` row (#61). Uptime checks poll
// GET /api/health/worker, apart from /api/health, so a stalled worker
// alerts as itself and not as "the app is down". docker/README.md,
// "Monitoring and alerts", lists the checks.

import type { DbWithClock } from "../db/app-db";

/** One worker's last beat in this database. */
export type HeartbeatBeat = { worker: string; lastSeenAt: Date };

export type WorkerFreshness =
  | { status: "ok" | "stale"; worker: { name: string; ageSeconds: number } }
  | { status: "missing" };

/**
 * How long a beat counts as alive: the worker beats after every poll (5 s),
 * and its container health check gives up after the same 120 s.
 */
export const WORKER_MAX_AGE_SECONDS = 120;

/**
 * Judges the freshest beat: "ok" while it is at most `maxAgeSeconds` old,
 * "stale" after, "missing" with no beat at all. A beat a little ahead of
 * `now` (the worker's clock runs ahead) counts as 0 s old.
 */
export function workerFreshness(
  beats: readonly HeartbeatBeat[],
  now: Date,
  { maxAgeSeconds }: { maxAgeSeconds: number }
): WorkerFreshness {
  const freshest = beats.reduce<HeartbeatBeat | undefined>(
    (best, beat) =>
      best === undefined || beat.lastSeenAt > best.lastSeenAt ? beat : best,
    undefined
  );
  if (freshest === undefined) return { status: "missing" };
  const ageMs = Math.max(0, now.getTime() - freshest.lastSeenAt.getTime());
  return {
    status: ageMs <= maxAgeSeconds * 1000 ? "ok" : "stale",
    worker: { name: freshest.worker, ageSeconds: Math.floor(ageMs / 1000) },
  };
}

/** The health of `environment`'s worker in this database. */
export async function readWorkerHealth(
  _deps: DbWithClock,
  _environment: string
): Promise<WorkerFreshness> {
  return { status: "missing" };
}
