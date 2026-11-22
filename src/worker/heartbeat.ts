// The worker's heartbeat row in each database it serves (worker_heartbeat).
//
// Loads under plain Node: relative imports only, no "server-only".

import type { AppDb } from "../server/db/app-db";
import { workerHeartbeat } from "../server/db/schema";
import type { WorkerIdentity } from "./tenant";

/** Upserts `identity`'s row: last seen at `at`, running its version. */
export async function recordHeartbeat(
  db: AppDb,
  identity: WorkerIdentity,
  at: Date
): Promise<void> {
  const row = { ...identity, lastSeenAt: at };
  await db
    .insert(workerHeartbeat)
    .values(row)
    .onConflictDoUpdate({
      target: workerHeartbeat.worker,
      set: {
        environment: row.environment,
        lastSeenAt: row.lastSeenAt,
        version: row.version,
      },
    });
}
