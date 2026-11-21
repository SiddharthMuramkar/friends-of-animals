import { env } from "./env";
import {
  requestErrorHandler,
  startErrorTracking,
} from "./server/observability/request-error";
import { useServerErrorReporter } from "./server/observability/server-reporter";
import type { ErrorReporter } from "./server/ports/errors";

/**
 * Validates the environment as the server starts and exits on a bad
 * config, so a misconfigured deployment fails at start instead of answering
 * every request with a 500. Called from `register` in src/instrumentation.ts.
 */
export function validateEnvOrExit() {
  try {
    env();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

let reporter: Promise<ErrorReporter> | undefined;

/**
 * The server's error reporter. `register` starts it after validating the
 * environment; without NEXT_PUBLIC_SENTRY_DSN it is silent and
 * `@sentry/nextjs` is never loaded.
 */
export function errorReporter(): Promise<ErrorReporter> {
  if (reporter === undefined) {
    const config = env();
    reporter = startErrorTracking({
      dsn: config.NEXT_PUBLIC_SENTRY_DSN,
      appEnv: config.APP_ENV,
      release: config.VERCEL_GIT_COMMIT_SHA,
      loadSdk: () => import("@sentry/nextjs"),
    }).then((started) => {
      // `deps.errors` in route handlers and server actions reports here.
      useServerErrorReporter(started);
      return started;
    });
  }
  return reporter;
}

export const onRequestError = requestErrorHandler(errorReporter);
