// Keeps one tenant (./tenant.ts) per database the worker serves and ticks
// them all on every poll. The run loop (./main.ts) calls `tick()` every
// WORKER_POLL_SECONDS; tests call it directly, with a fake clock and fake
// tenants, so nothing here sleeps or sets a timer.
//
// - Discovery: the databases are listed on the first tick and again once
//   `discoveryIntervalMs` has passed. A newly listed one gets a tenant; one
//   no longer listed is closed. Single-database mode lists one fixed name.
// - A tenant whose tick says its database is gone (SQLSTATE 3D000: the
//   sweeper dropped the preview) is closed at once, before the next listing.
//   Other failures are logged, once until the tenant recovers, and retried
//   on the next tick.
// - Health: `beat()` (the heartbeat file Docker's health check reads) runs
//   after a tick while the last listing succeeded and, with
//   `everyTenantMustTick` (single mode), every listed database has a tenant
//   that ticked.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { Clock } from "../server/ports/clock";
import { summarizeError, type WorkerLog } from "./log";
import { isDatabaseGone, planPreviewChanges } from "./preview-databases";
import type { Tenant } from "./tenant";

export type Supervisor = {
  /** Lists databases if due, then ticks every tenant, then beats if healthy. */
  tick(): Promise<void>;
  /** The databases with a tenant, in name order. */
  serving(): string[];
  /** Closes every tenant. */
  stop(): Promise<void>;
};

export type SupervisorOptions = {
  clock: Clock;
  /** How long a listing holds before the next tick lists again. */
  discoveryIntervalMs: number;
  /**
   * True in single mode: a failing tick of the one database stops the
   * heartbeat. False on the preview worker, where one broken preview must
   * not mark the worker unhealthy.
   */
  everyTenantMustTick: boolean;
  /** The databases to serve, by name. */
  listDatabases: () => Promise<readonly string[]>;
  /** Opens a database's connections and returns its tenant. */
  startTenant: (database: string) => Promise<Tenant>;
  /** Records that the worker is healthy at `at`. */
  beat: (at: Date) => Promise<void>;
  log: WorkerLog;
};

type Attached = {
  tenant: Tenant;
  /** The last failure logged, until a tick succeeds. */
  failure: string | undefined;
};

export function createSupervisor({
  clock,
  discoveryIntervalMs,
  everyTenantMustTick,
  listDatabases,
  startTenant,
  beat,
  log,
}: SupervisorOptions): Supervisor {
  const tenants = new Map<string, Attached>();
  let listedAt: number | undefined;
  let listed: readonly string[] = [];
  let listingFailed = false;

  async function detach(
    database: string,
    reason: "unlisted" | "gone" | "stopping"
  ) {
    const attached = tenants.get(database);
    if (!attached) return;
    tenants.delete(database);
    try {
      await attached.tenant.close();
    } catch (error) {
      log({
        level: "error",
        event: "tenant.close_failed",
        database,
        error: summarizeError(error),
      });
    }
    log({ level: "info", event: "tenant.detached", database, reason });
  }

  async function attach(database: string) {
    try {
      tenants.set(database, {
        tenant: await startTenant(database),
        failure: undefined,
      });
      log({ level: "info", event: "tenant.attached", database });
    } catch (error) {
      // Tried again at the next listing.
      log({
        level: "error",
        event: "tenant.attach_failed",
        database,
        error: summarizeError(error),
      });
    }
  }

  async function discover(now: number) {
    if (listedAt !== undefined && now - listedAt < discoveryIntervalMs) return;
    try {
      listed = await listDatabases();
    } catch (error) {
      // Keep serving what is attached; list again on the next tick.
      if (!listingFailed) {
        log({
          level: "error",
          event: "discovery.failed",
          error: summarizeError(error),
        });
      }
      listingFailed = true;
      return;
    }
    listingFailed = false;
    listedAt = now;
    const { attach: toAttach, detach: toDetach } = planPreviewChanges(
      tenants.keys(),
      listed
    );
    for (const database of toDetach) await detach(database, "unlisted");
    for (const database of toAttach) await attach(database);
  }

  /** Ticks one tenant; false if it failed. */
  async function tickOne(database: string, attached: Attached) {
    try {
      const report = await attached.tenant.tick();
      attached.failure = undefined;
      if (report.dispatched + report.retried + report.failed > 0) {
        log({ level: "info", event: "tenant.drained", database, ...report });
      }
      return true;
    } catch (error) {
      if (isDatabaseGone(error)) {
        await detach(database, "gone");
        return false;
      }
      const summary = summarizeError(error);
      if (attached.failure !== summary) {
        log({
          level: "error",
          event: "tenant.tick_failed",
          database,
          error: summary,
        });
      }
      attached.failure = summary;
      return false;
    }
  }

  return {
    async tick() {
      await discover(clock.now().getTime());
      const results = await Promise.all(
        [...tenants].map(([database, attached]) =>
          tickOne(database, attached)
        )
      );
      const healthy =
        !listingFailed &&
        (!everyTenantMustTick ||
          (listed.every((database) => tenants.has(database)) &&
            results.every((ticked) => ticked)));
      if (healthy) await beat(clock.now());
    },
    serving: () => [...tenants.keys()].sort(),
    async stop() {
      // Deleting the entry being visited is safe in a Map's iteration.
      for (const database of tenants.keys()) {
        await detach(database, "stopping");
      }
    },
  };
}
