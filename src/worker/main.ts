// The VPS worker's entry point: `pnpm worker` (Docker target `worker`,
// docker/workers.yml) and `pnpm worker:dev` (a local run). Reads its
// configuration (./config.ts), starts error tracking (./errors.ts) and the
// worker (./worker.ts) and ticks it every WORKER_POLL_SECONDS until SIGTERM
// or SIGINT, then finishes the tick in flight, stops pg-boss, closes every
// connection and sends the errors still queued (at most 2 s).
//
// Runs under plain Node through tsx: it never imports "server-only",
// "@/env" or src/server/db/index.ts (the app's pooled client).

import { readFile, writeFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { PgBoss } from "pg-boss";
import postgres from "postgres";

import { loadEnvFiles } from "../../scripts/load-env";
import { directTls } from "../server/db/database-url";
import * as schema from "../server/db/schema";
import { systemClock } from "../server/ports/clock";
import { malwareScannerFor } from "../server/ports/malware-scanner-clamav";
import { unconfiguredStorage } from "../server/ports/storage";
import { r2Storage } from "../server/ports/storage-r2";
import { withPassword, workerConfig, type WorkerConfig } from "./config";
import { exitOnUncaught, startWorkerErrors, type WorkerErrors } from "./errors";
import { summarizeError, type WorkerLog } from "./log";
import type { ListedDatabase } from "./preview-databases";
import { createWorker, type WorkerIo } from "./worker";

/** pg-boss's own pool: its supervisor, cron and the schedule workers. */
const BOSS_CONNECTIONS = 2;

/** How long a stop waits for running schedule jobs. */
const BOSS_STOP_TIMEOUT_MS = 20_000;

const log: WorkerLog = (entry) => {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`
  );
};

/** Direct connections (not PgBouncer): pg-boss needs a session. */
function client(url: string, max: number) {
  return postgres(url, {
    ...directTls(url),
    max,
    connect_timeout: 10,
    connection: { application_name: "foa-worker" },
    // Notices (CREATE ... IF NOT EXISTS) are noise in the log.
    onnotice: () => {},
  });
}

function realIo(config: WorkerConfig, errors: WorkerErrors): WorkerIo {
  return {
    onTenantError: errors.tenantFailed,
    errors: errors.reporter,
    clock: systemClock,
    log,
    // Never the app's local scanner or disk store: without R2 or clamd
    // every scan fails, and files wait unscanned for a worker that has them.
    storage: config.r2
      ? r2Storage(config.r2, systemClock)
      : unconfiguredStorage,
    scanner: malwareScannerFor(config.clamd),
    openDatabase(url, connections) {
      const sql = client(url, connections);
      return { db: drizzle(sql, { schema }), end: () => sql.end() };
    },
    openCatalog(adminUrl) {
      const sql = client(adminUrl, 1);
      return {
        list: () =>
          sql<ListedDatabase[]>`
            SELECT d.datname, shobj_description(d.oid, 'pg_database') AS comment
              FROM pg_database AS d
             WHERE shobj_description(d.oid, 'pg_database') LIKE 'foa-preview %'
             ORDER BY 1`,
        end: () => sql.end(),
      };
    },
    async startBoss(url) {
      const boss = new PgBoss({
        connectionString: url,
        schema: "pgboss",
        max: BOSS_CONNECTIONS,
        application_name: "foa-worker-boss",
        // On the VPS the bootstrap SQL makes the worker role own schema
        // pgboss (docker/postgres/bootstrap/workers-prod.sql and
        // workers-nonprod.sql); the role has no CREATE on the database. A
        // local run's role owns everything.
        createSchema: config.appEnv === "local",
      });
      boss.on("error", (error) =>
        log({
          level: "error",
          event: "boss.error",
          error: summarizeError(error),
        })
      );
      await boss.start();
      return {
        getSchedules: () => boss.getSchedules(),
        unschedule: (name) => boss.unschedule(name),
        createQueue: (name) => boss.createQueue(name),
        schedule: (name, cron, data, options) =>
          boss.schedule(name, cron, data, options),
        work: (name, options, handler) => boss.work(name, options, handler),
        stop: () =>
          boss.stop({ graceful: true, timeout: BOSS_STOP_TIMEOUT_MS }),
      };
    },
    async beat(at) {
      await writeFile(config.heartbeatFile, `${at.toISOString()}\n`);
    },
  };
}

/** Started once the configuration parses; reports until the worker exits. */
let errors: WorkerErrors | undefined;

async function main() {
  loadEnvFiles();
  const parsed = workerConfig(process.env);
  const started = await startWorkerErrors({
    dsn: parsed.sentryDsn,
    appEnv: parsed.appEnv,
    version: parsed.identity.version,
    // Loaded only when SENTRY_DSN is set.
    loadSdk: () => import("@sentry/node"),
    log,
  });
  errors = started;
  exitOnUncaught(started.reporter, {
    process,
    exit: (code) => process.exit(code),
    log,
  });
  const config =
    parsed.passwordFile === undefined
      ? parsed
      : withPassword(parsed, await readFile(parsed.passwordFile, "utf8"));
  const worker = createWorker(config, realIo(config, started));

  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  await worker.start();
  while (!stopping) {
    await worker.tick();
    if (stopping) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.pollMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = undefined;
  }
  await worker.stop();
  await started.flush();
}

main().catch((error: unknown) => {
  // A configuration error names variables only, never their values.
  const message =
    error instanceof Error && error.message.startsWith("Invalid environment")
      ? error.message
      : summarizeError(error);
  log({ level: "error", event: "worker.failed", error: message });
  // A failure after error tracking started (pg-boss or a database that
  // won't start) reaches Sentry too, before the exit.
  errors?.reporter.report(error, { where: "worker.main" });
  void (errors?.flush() ?? Promise.resolve(true)).finally(() =>
    process.exit(1)
  );
});
