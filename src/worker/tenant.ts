// One database the worker serves: its relay and its heartbeat row. In
// single-database mode (production, staging, local) the worker has one
// tenant; the shared preview worker has one per live preview database
// (./supervisor.ts attaches and detaches them).
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  drainOutbox,
  drainUntilIdle,
  type DrainOptions,
  type DrainReport,
  type OutboxDeps,
} from "../server/outbox";
import { recordHeartbeat } from "./heartbeat";

/** Who writes the heartbeat. */
export type WorkerIdentity = {
  /** e.g. worker-staging, worker-preview. */
  worker: string;
  environment: "local" | "preview" | "staging" | "production";
  /** The code it runs: a git commit, or "dev". */
  version: string;
};

export type Tenant = {
  /** The database's name. */
  readonly database: string;
  /**
   * Sends every delivery that is due, then records the heartbeat. Rejects
   * if the database can't be reached (`isDatabaseGone` tells if it was
   * dropped); a failing handler doesn't reject, the relay retries it.
   */
  tick: () => Promise<DrainReport>;
  /** Ends the database connections. */
  close: () => Promise<void>;
};

export function createTenant({
  database,
  deps,
  identity,
  end,
  drain = {},
  heartbeatRow = true,
}: {
  database: string;
  /** What the relay and handlers run against, on this database. */
  deps: OutboxDeps;
  identity: WorkerIdentity;
  /** Ends `deps.db`'s connections. */
  end: () => Promise<void>;
  /** Which queue it drains (the default one unless told). */
  drain?: DrainOptions;
  /**
   * Whether it upserts its worker_heartbeat row. worker-media doesn't:
   * /api/health/worker judges an environment by its rows, so a media
   * worker's beat would stand in for a stalled default worker's.
   */
  heartbeatRow?: boolean;
}): Tenant {
  return {
    database,
    async tick() {
      const report =
        drain.queue === "media"
          ? await drainOutbox(deps, { queue: "media", limit: 1 })
          : await drainUntilIdle(deps, drain);
      if (heartbeatRow) {
        await recordHeartbeat(deps.db, identity, deps.clock.now());
      }
      return report;
    },
    close: end,
  };
}
