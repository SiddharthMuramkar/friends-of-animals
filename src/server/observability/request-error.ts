// Server-side error tracking (#66): starts the SDK when the server starts,
// and reports every error Next.js catches in a page, route handler, server
// action or the proxy (`onRequestError` in src/instrumentation.ts).
//
// The handler is ours rather than the SDK's `captureRequestError`, so the
// request's headers (cookies, authorization) never reach the SDK at all.

import type { Instrumentation } from "next";

import {
  errorTracking,
  sentryOptions,
  type SentryOptions,
} from "@/lib/observability/config";
import { stripQuery } from "@/lib/observability/scrub";
import {
  hashUserId,
  silentErrorReporter,
  type ErrorReporter,
} from "@/server/ports/errors";
import {
  sentryErrorReporter,
  type SentrySdk,
} from "@/server/ports/errors-sentry";

/**
 * How long a failed request waits for its event to be sent. Next.js awaits
 * `onRequestError`, and a Vercel Function may be frozen once it answers,
 * so the event goes before the error response does.
 */
const FLUSH_TIMEOUT_MS = 2000;

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

/**
 * Starts error tracking and returns the reporter the server uses. Without
 * a DSN it is off and the SDK is never loaded. A malformed DSN throws
 * (the env schema rejects it first); an SDK that fails to load is logged
 * and leaves tracking off, so the server still starts.
 */
export async function startErrorTracking({
  dsn,
  appEnv,
  release,
  loadSdk,
}: StartErrorTrackingInput): Promise<ErrorReporter> {
  const tracking = errorTracking({ dsn, appEnv, release });
  if (!tracking.enabled) return silentErrorReporter;
  try {
    const sdk = await loadSdk();
    sdk.init(sentryOptions(tracking, { hashUserId }));
    return sentryErrorReporter(sdk);
  } catch (error) {
    console.error(
      "Error tracking is off: the Sentry SDK failed to start.",
      error
    );
    return silentErrorReporter;
  }
}

/** The digest Next.js gave a server error, shown on the error page. */
function digestOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return undefined;
  }
  return typeof error.digest === "string" ? error.digest : undefined;
}

/** Builds `onRequestError` over the reporter `startErrorTracking` gave. */
export function requestErrorHandler(
  reporter: () => ErrorReporter | Promise<ErrorReporter>
): Instrumentation.onRequestError {
  return async (error, request, context) => {
    const tracker = await reporter();
    const digest = digestOf(error);
    tracker.report(error, {
      where: "onRequestError",
      tags: {
        "route.path": context.routePath,
        "route.type": context.routeType,
        "router.kind": context.routerKind,
        "http.method": request.method,
        ...(digest === undefined ? {} : { digest }),
      },
      extra: { path: stripQuery(request.path) },
    });
    await tracker.flush(FLUSH_TIMEOUT_MS);
  };
}
