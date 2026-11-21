export type HeartbeatBeat = { worker: string; lastSeenAt: Date };

export type WorkerFreshness =
  | { status: "ok" | "stale"; worker: { name: string; ageSeconds: number } }
  | { status: "missing" };

export function workerFreshness(
  _rows: readonly HeartbeatBeat[],
  _now: Date,
  _options: { maxAgeSeconds: number }
): WorkerFreshness {
  return { status: "missing" };
}
