// Worker error tracking (#66): `@sentry/node` behind the ErrorReporter
// port, started from SENTRY_DSN. Without a DSN the worker never loads the
// SDK and reports nowhere. Events carry APP_ENV as their environment and
// pass the same scrubber as the app's (src/lib/observability/config.ts).
//
// What is reported:
//   - a tenant's failed tick (`tenantFailed`, the supervisor's onError),
//     tagged with the database: preview names (foa_pr_<n>_<fp>) are not
//     personal data;
//   - an uncaught exception or unhandled rejection (`exitOnUncaught`),
//     after which the worker exits 1, as Node would have, and Docker
//     restarts it.
// The SDK's own process handlers stay out: its unhandled-rejection handler
// would keep a broken worker running, and only when a DSN is set.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { EventEmitter } from "node:events";

import {
  errorTracking,
  sentryOptions,
  type SentryOptions,
} from "../lib/observability/config";
import { errorSummaryForLogs } from "../server/errors";
import {
  DEFAULT_FLUSH_TIMEOUT_MS,
  hashUserId,
  silentErrorReporter,
  type ErrorReporter,
} from "../server/ports/errors";
import { sentryErrorReporter, type SentrySdk } from "../server/ports/errors-sentry";

/** The SDK integrations that install process handlers; ours replace them. */
const SDK_PROCESS_HANDLERS = new Set([
  "OnUncaughtException",
  "OnUnhandledRejection",
]);

export type WorkerSentryOptions = SentryOptions & {
  integrations: <T extends { name: string }>(defaults: T[]) => T[];
};

/** The part of `@sentry/node` the worker uses. */
export type WorkerSentrySdk = SentrySdk & {
  init(options: WorkerSentryOptions): unknown;
};

/** The worker's log (./log.ts) as these functions use it. */
type ErrorLog = (entry: {
  level: "error";
  event: string;
  error?: string;
}) => void;

export type WorkerErrors = {
  /** Sentry when SENTRY_DSN is set, silent otherwise. */
  reporter: ErrorReporter;
  /** The supervisor's onError: a tenant's tick failed. */
  tenantFailed(error: unknown, where: { tenant: string }): void;
  /** Sends what is queued, waiting at most 2 s. Call before exiting. */
  flush(): Promise<boolean>;
};

export type StartWorkerErrorsInput = {
  /** SENTRY_DSN; unset turns error tracking off. */
  dsn: string | undefined;
  /** APP_ENV, which every event carries as its environment. */
  appEnv: string;
  /** The commit the worker runs (WORKER_VERSION), when known. */
  release?: string | undefined;
  /** Loads the SDK. Called only when a DSN is set. */
  loadSdk: () => Promise<WorkerSentrySdk>;
  log: ErrorLog;
};

/**
 * Starts error tracking for the worker. A malformed DSN throws, so a typo
 * fails the start; an SDK that fails to load is logged and leaves
 * tracking off, so the worker still runs.
 */
export async function startWorkerErrors({
  dsn,
  appEnv,
  release,
  loadSdk,
  log,
}: StartWorkerErrorsInput): Promise<WorkerErrors> {
  const tracking = errorTracking({ dsn, appEnv, release });
  let reporter: ErrorReporter = silentErrorReporter;
  if (tracking.enabled) {
    try {
      const sdk = await loadSdk();
      sdk.init({
        ...sentryOptions(tracking, { hashUserId }),
        integrations: (defaults) =>
          defaults.filter(({ name }) => !SDK_PROCESS_HANDLERS.has(name)),
      });
      reporter = sentryErrorReporter(sdk);
    } catch (error) {
      log({
        level: "error",
        event: "errors.sdk_failed",
        error: errorSummaryForLogs(error),
      });
    }
  }
  return {
    reporter,
    tenantFailed: (error, { tenant }) =>
      reporter.report(error, { where: "worker.tick", tags: { tenant } }),
    flush: () => reporter.flush(DEFAULT_FLUSH_TIMEOUT_MS),
  };
}

/**
 * Reports an uncaught exception or unhandled rejection, flushes for at
 * most 2 s, then exits 1, as Node would have without these handlers. A
 * second error while flushing is reported but changes nothing.
 */
export function exitOnUncaught(
  reporter: ErrorReporter,
  io: {
    process: Pick<EventEmitter, "on">;
    exit: (code: number) => void;
    log: ErrorLog;
  }
): void {
  let exiting = false;
  const handle =
    (event: "uncaughtException" | "unhandledRejection") =>
    (error: unknown) => {
      reporter.report(error, { where: `worker.${event}` });
      io.log({
        level: "error",
        event: `worker.${event}`,
        error: errorSummaryForLogs(error),
      });
      if (exiting) return;
      exiting = true;
      void reporter
        .flush(DEFAULT_FLUSH_TIMEOUT_MS)
        .finally(() => io.exit(1));
    };
  io.process.on("uncaughtException", handle("uncaughtException"));
  io.process.on("unhandledRejection", handle("unhandledRejection"));
}
