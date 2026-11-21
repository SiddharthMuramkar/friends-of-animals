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

import type { FieldCipher } from "../server/crypto/field-cipher";
import { fieldCryptoFor } from "../server/crypto/keys";
import type { AppDb } from "../server/db/app-db";
import { withDatabase } from "../server/db/database-url";
import { SCHEDULES, type OutboxDeps } from "../server/outbox";
import type { Clock } from "../server/ports/clock";
import { emailSenderFor } from "../server/ports/email-sender-for";
import { settingsFor } from "../server/ports/settings-for";
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

/** A field cipher that `make` builds on first use. */
function cipherOnFirstUse(make: () => FieldCipher): FieldCipher {
  let cipher: FieldCipher | undefined;
  return {
    encrypt: (purpose, plaintext) =>
      (cipher ??= make()).encrypt(purpose, plaintext),
    decrypt: (purpose, stored) => (cipher ??= make()).decrypt(purpose, stored),
  };
}

export function createWorker(config: WorkerConfig, io: WorkerIo): Worker {
  let supervisor: Supervisor | undefined;
  const cleanups: (() => Promise<void>)[] = [];

  // #69's dispatcher reads stored phone numbers with the field cipher. The
  // worker has no field keys or MSG91 keys of its own yet: locally and in
  // previews the cipher uses the public development keys, as the app does;
  // on staging and production it refuses, and only when a delivery needs a
  // phone, so messages to everyone else still go. SMS goes through the
  // app's adapters, so production refuses it without MSG91's keys.
  const cipher = cipherOnFirstUse(
    () => fieldCryptoFor({ APP_ENV: config.appEnv }).cipher
  );
  const depsFor = (db: AppDb): OutboxDeps => ({
    db,
    clock: io.clock,
    email: emailSenderFor(config.appEnv, { db, clock: io.clock }),
    sms: smsSenderFor(config.appEnv, { db, clock: io.clock }, {}),
    settings: settingsFor(config.appEnv),
    cipher,
  });

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
