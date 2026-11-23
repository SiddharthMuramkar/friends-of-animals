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
import { fieldCryptoFor, type FieldKeyEnv } from "../server/crypto/keys";
import type { AppDb } from "../server/db/app-db";
import { withDatabase } from "../server/db/database-url";
import { databaseSettings } from "../server/modules/settings/read";
import {
  SCHEDULES,
  type DrainOptions,
  type OutboxDeps,
} from "../server/outbox";
import type { Clock } from "../server/ports/clock";
import { emailSenderFor } from "../server/ports/email-sender-for";
import type { ErrorReporter } from "../server/ports/errors";
import type { MalwareScanner } from "../server/ports/malware-scanner";
import { unconfiguredMedia, type MediaProcessor } from "../server/ports/media";
import { paymentGatewayFor } from "../server/ports/payment-gateway-select";
import { smsSenderFor } from "../server/ports/sms-sender-for";
import type { ObjectStorage } from "../server/ports/storage";
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
  /** Where uploaded files and their derivatives are kept (#63, #85). */
  storage: ObjectStorage;
  /** Checks each upload for malware (#63). */
  scanner: MalwareScanner;
  /**
   * Makes worker-media's media processor (sharp, #85). Only the media queue
   * calls it, so the default workers never load the image libraries.
   */
  makeMediaProcessor: (options: {
    timeoutSeconds: number;
  }) => Promise<MediaProcessor>;
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
  /** Where a scheduled run reports its failures: Sentry (./errors.ts). */
  errors: ErrorReporter;
};

export type Worker = {
  /** Opens connections, and registers the schedules in single mode. */
  start(): Promise<void>;
  /** One poll: see ./supervisor.ts. */
  tick(): Promise<void>;
  /** Stops pg-boss and ends every connection. */
  stop(): Promise<void>;
};

/**
 * The field cipher, made at its first use: the worker decrypts a stored
 * phone to send an SMS (src/server/modules/notifications/dispatch.ts), and
 * an invitation's address and link to send it (#74). A local or preview
 * worker without FIELD_ENCRYPTION_KEYS and FIELD_HMAC_KEY uses the public
 * development keys; a staging or production one without them refuses each
 * such delivery with fieldCryptoFor's reason, kept on the outbox row for
 * staff, while every other message goes.
 */
function cipherOnFirstUse(env: FieldKeyEnv): FieldCipher {
  let cipher: FieldCipher | undefined;
  const made = () => (cipher ??= fieldCryptoFor(env).cipher);
  return {
    encrypt: (purpose, plaintext) => made().encrypt(purpose, plaintext),
    decrypt: (purpose, stored) => made().decrypt(purpose, stored),
  };
}

export function createWorker(config: WorkerConfig, io: WorkerIo): Worker {
  let supervisor: Supervisor | undefined;
  const cleanups: (() => Promise<void>)[] = [];
  const cipher = cipherOnFirstUse({
    APP_ENV: config.appEnv,
    FIELD_ENCRYPTION_KEYS: config.fieldEncryptionKeys,
    FIELD_HMAC_KEY: config.fieldHmacKey,
  });
  /** The default workers never process media: their queue has no media job. */
  let media: MediaProcessor = unconfiguredMedia;
  const isMedia = config.queue.name === "media";
  const drain: DrainOptions = { queue: config.queue.name };

  // The same adapters as the app's deps (src/server/deps.ts). No MSG91
  // or SES keys yet, so production refuses SMS, as it does while
  // sms.enabled is off, and email, until AWS grants SES production access
  // (DECISIONS R-27); the runtime settings are the database's own.
  const depsFor = (db: AppDb): OutboxDeps => ({
    appEnv: config.appEnv,
    db,
    clock: io.clock,
    email: emailSenderFor(config.appEnv, { db, clock: io.clock }, {}),
    sms: smsSenderFor(config.appEnv, { db, clock: io.clock }, {}),
    settings: databaseSettings(db),
    cipher,
    auth: { baseUrl: config.siteUrl },
    storage: io.storage,
    scanner: io.scanner,
    media,
    // Refunds (#80), through the adapter the app picks for this
    // environment and keys: the fallback lives in this database.
    payments: paymentGatewayFor(
      {
        APP_ENV: config.appEnv,
        RAZORPAY_KEY_ID: config.razorpay?.keyId,
        RAZORPAY_KEY_SECRET: config.razorpay?.keySecret,
        RAZORPAY_WEBHOOK_SECRET: config.razorpay?.webhookSecret,
      },
      { db, clock: io.clock }
    ),
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
    // The schedules run once per database, on its default worker.
    if (!isMedia) {
      const boss = await io.startBoss(single.databaseUrl);
      cleanups.unshift(() => boss.stop());
      await registerSchedules(boss, SCHEDULES, { ...deps, errors: io.errors });
    }
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
          drain,
          heartbeatRow: !isMedia,
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
          drain,
          heartbeatRow: !isMedia,
        });
      },
      beat: io.beat,
      log: io.log,
      onError: io.onTenantError,
    });
  }

  return {
    async start() {
      if (config.queue.name === "media") {
        media = await io.makeMediaProcessor({
          timeoutSeconds: config.queue.timeoutSeconds,
        });
      }
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
