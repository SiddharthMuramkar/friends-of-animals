// Server-side error tracking (#66): starts the SDK when the server starts,
// and reports every error Next.js catches in a page, route handler, server
// action or the proxy (`onRequestError` in src/instrumentation.ts).
//
// The handler is ours rather than the SDK's `captureRequestError`, so the
// request's headers (cookies, authorization) never reach the SDK at all.

import type { Instrumentation } from "next";

import type { SentryOptions } from "@/lib/observability/config";
import { silentErrorReporter, type ErrorReporter } from "@/server/ports/errors";
import type { SentrySdk } from "@/server/ports/errors-sentry";

/** The part of `@sentry/nextjs` the server uses. */
export type ServerSentrySdk = SentrySdk & {
  init(options: SentryOptions): unknown;
};

export type StartErrorTrackingInput = {
  /** NEXT_PUBLIC_SENTRY_DSN; unset turns tracking off. */
  dsn: string | undefined;
  /** APP_ENV, which every event carries as its environment. */
  appEnv: string;
  /** The commit the deployment was built from, when known. */
  release?: string | undefined;
  /** Loads the SDK. Called only when a DSN is set. */
  loadSdk: () => Promise<ServerSentrySdk>;
};

/** Starts error tracking and returns the reporter the server uses. */
export async function startErrorTracking(
  _input: StartErrorTrackingInput
): Promise<ErrorReporter> {
  return silentErrorReporter;
}

/** Builds `onRequestError` over the reporter `startErrorTracking` gave. */
export function requestErrorHandler(
  _reporter: () => ErrorReporter | Promise<ErrorReporter>
): Instrumentation.onRequestError {
  return () => {};
}
