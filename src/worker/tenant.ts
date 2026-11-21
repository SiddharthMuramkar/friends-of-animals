// One database the worker serves.

import type { DrainReport, OutboxDeps } from "../server/outbox";

/** Who writes the heartbeat. */
export type WorkerIdentity = {
  worker: string;
  environment: "local" | "preview" | "staging" | "production";
  version: string;
};

export type Tenant = {
  readonly database: string;
  tick(): Promise<DrainReport>;
  close(): Promise<void>;
};

export function createTenant(_options: {
  database: string;
  deps: OutboxDeps;
  identity: WorkerIdentity;
  end(): Promise<void>;
}): Tenant {
  return {
    database: _options.database,
    tick: async () => ({ dispatched: 0, retried: 0, failed: 0, skipped: 0 }),
    close: async () => {},
  };
}
