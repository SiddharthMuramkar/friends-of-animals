// The VPS worker's heartbeat (#61): each worker process upserts its row in
// every database it serves after each drain, so staff and /api/health
// (#66) can tell a stalled worker from an idle one. A preview database
// holds the shared preview worker's row; staging and production hold their
// own worker's.
//
// Loads under plain Node (drizzle-kit, the worker): relative imports only,
// no "server-only".

import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const workerHeartbeat = pgTable(
  "worker_heartbeat",
  {
    /** The worker's name, e.g. worker-staging or worker-preview. */
    worker: text().primaryKey(),
    /** The APP_ENV the worker runs as. */
    environment: text().notNull(),
    /** The end of the worker's last drain of this database. */
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    /** The code the worker runs: a git commit, or "dev". */
    version: text().notNull(),
  },
  (table) => [
    check(
      "worker_heartbeat_environment_known",
      sql`${table.environment} IN ('local', 'preview', 'staging', 'production')`
    ),
  ]
);

export type WorkerHeartbeatRow = typeof workerHeartbeat.$inferSelect;
