// The relay: claims due deliveries, runs their handlers and settles them.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { AppDb } from "../db/app-db";
import type { Clock } from "../ports/clock";
import type { EmailSender } from "../ports/email";

/** What the relay and handlers run against; the worker can supply it. */
export type OutboxDeps = { db: AppDb; clock: Clock; email: EmailSender };

export type DrainReport = {
  dispatched: number;
  retried: number;
  failed: number;
  skipped: number;
};

export const DEFAULT_DRAIN_LIMIT = 25;

export async function drainOutbox(
  _deps: OutboxDeps,
  _options: { limit?: number } = {}
): Promise<DrainReport> {
  return { dispatched: 0, retried: 0, failed: 0, skipped: 0 };
}

export async function drainUntilIdle(deps: OutboxDeps): Promise<DrainReport> {
  return drainOutbox(deps);
}
