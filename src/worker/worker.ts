// Puts the worker together for its mode, over injected I/O (./main.ts
// supplies postgres.js, pg-boss, the system clock and the heartbeat file;
// tests supply PGlite and fakes).
//
// - single (production, staging, local): one database, drained every poll;
//   the SCHEDULES registry runs on pg-boss in the same database.
// - preview: every live preview database on pg-nonprod, listed through the
//   admin connection and reached by swapping its path; no pg-boss.
//
// Loads under plain Node: relative imports only, no "server-only".

import { fieldCryptoFor } from "../server/crypto/keys";
import type { AppDb } from "../server/db/app-db";
import { withDatabase } from "../server/db/database-url";
import { SCHEDULES, type OutboxDeps } from "../server/outbox";
import type { Clock } from "../server/ports/clock";
import { emailSenderFor } from "../server/ports/email-sender-for";
import { settingsFor } from "../server/ports/settings";
import { smsSenderFor } from "../server/ports/sms-sender-for";
import type { WorkerConfig } from "./config";
import type { WorkerLog } from "./log";
import {
  previewDatabasesToServe,
  type ListedDatabase,
} from "./preview-databases";
import { registerSchedules, type ScheduleBoss } from "./schedules";
import { createSupervisor, type Supervisor } from "./supervisor";
import { createTenant } from "./tenant";

/** A database client and how to end its connections. */
export type OpenedDatabase = { db: AppDb; end: () => Promise<void> };

/** What the worker does I/O through. */
export type WorkerIo = {
  clock: Clock;
  log: WorkerLog;
  /** A client for `url` holding at most `connections` connections. */
  openDatabase: (url: string, connections: number) => OpenedDatabase;
  /** pg-nonprod's databases and their comments, through `adminUrl`. */
  openCatalog: (adminUrl: string) => {
    list: () => Promise<ListedDatabase[]>;
    end: () => Promise<void>;
  };
  /** A started pg-boss on `url`. */
  startBoss: (
    url: string
  ) => Promise<ScheduleBoss & { stop: () => Promise<void> }>;
  /** Marks the worker healthy at `at` (the heartbeat file). */
  beat: (at: Date) => Promise<void>;
  /** A tenant's tick failed: Sentry (#66, ./errors.ts). */
  onTenantError: (error: unknown, where: { tenant: string }) => void;
};

export type Worker = {
  /** Opens connections, and registers the schedules in single mode. */
  start(): Promise<void>;
  /** One poll: see ./supervisor.ts. */
  tick(): Promise<void>;
  /** Stops pg-boss and ends every connection. */
  stop(): Promise<void>;
};

export function createWorker(config: WorkerConfig, io: WorkerIo): Worker {
  let supervisor: Supervisor | undefined;
  const cleanups: (() => Promise<void>)[] = [];

  // Messages read a recipient's stored phone (#69). Like the app, staging
  // and production refuse to start without their own keys.
  const { cipher } = fieldCryptoFor({
    APP_ENV: config.appEnv,
    FIELD_ENCRYPTION_KEYS: config.fieldEncryptionKeys,
    FIELD_HMAC_KEY: config.fieldHmacKey,
  });
  const settings = settingsFor(config.appEnv);

  const depsFor = (db: AppDb): OutboxDeps => {
    const store = { db, clock: io.clock };
    return {
      ...store,
      email: emailSenderFor(config.appEnv, store),
      // MSG91's keys don't reach the worker yet, so production refuses
      // SMS; it stays switched off until DLT approval (HR-14) anyway.
      sms: smsSenderFor(config.appEnv, store, {}),
      settings,
      cipher,
    };
  };

  async function startSingle(
    single: Extract<WorkerConfig, { mode: "single" }>
  ) {
    // One client for the drains and the schedules.
    const opened = io.openDatabase(
      single.databaseUrl,
      single.connectionsPerDatabase
    );
    cleanups.push(opened.end);
    const deps = depsFor(opened.db);
    const boss = await io.startBoss(single.databaseUrl);
    cleanups.unshift(() => boss.stop());
    await registerSchedules(boss, SCHEDULES, deps);
    return createSupervisor({
      clock: io.clock,
      discoveryIntervalMs: 0,
      everyTenantMustTick: true,
      listDatabases: async () => [single.database],
      startTenant: async (database) =>
        createTenant({
          database,
          deps,
          identity: single.identity,
          // The client outlives the tenant; stop() ends it.
          end: async () => {},
        }),
      beat: io.beat,
      log: io.log,
      onError: io.onTenantError,
    });
  }

  function startPreview(preview: Extract<WorkerConfig, { mode: "preview" }>) {
    const catalog = io.openCatalog(preview.adminUrl);
    cleanups.push(catalog.end);
    return createSupervisor({
      clock: io.clock,
      discoveryIntervalMs: preview.discoveryMs,
      everyTenantMustTick: false,
      listDatabases: async () => previewDatabasesToServe(await catalog.list()),
      startTenant: async (database) => {
        const opened = io.openDatabase(
          withDatabase(preview.adminUrl, database),
          preview.connectionsPerDatabase
        );
        return createTenant({
          database,
          deps: depsFor(opened.db),
          identity: preview.identity,
          end: opened.end,
        });
      },
      beat: io.beat,
      log: io.log,
      onError: io.onTenantError,
    });
  }

  return {
    async start() {
      supervisor =
        config.mode === "single"
          ? await startSingle(config)
          : startPreview(config);
      io.log({
        level: "info",
        event: "worker.started",
        mode: config.mode,
        worker: config.identity.worker,
        version: config.identity.version,
      });
    },
    async tick() {
      if (!supervisor) throw new Error("Start the worker before ticking it");
      await supervisor.tick();
    },
    async stop() {
      await supervisor?.stop();
      for (const cleanup of cleanups.splice(0)) await cleanup();
      io.log({ level: "info", event: "worker.stopped" });
    },
  };
}
