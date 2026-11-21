// Browser error tracking (#66), started by src/instrumentation-client.ts.
// It costs every page almost nothing: two listeners, until the first
// error. Only then does it load the Sentry SDK (a separate chunk, never in
// a page's initial JS), start it with the scrubber and the same-origin
// tunnel, hand it the errors seen so far, and step aside for the SDK's own
// handlers. No DSN at build time: nothing at all.
//
// Like the rest of src/lib/observability, no RegExp lookbehind here.

import type { SentryOptions } from "./config";

/** Where the browser sends its envelopes (src/app/monitoring/route.ts). */
export const TUNNEL_PATH = "/monitoring";

/** A Sentry integration, as `init`'s `integrations` option sees it. */
type Integration = { name: string };

/** The part of `@sentry/nextjs` the browser uses. */
export type BrowserSentrySdk = {
  init(
    options: SentryOptions & {
      tunnel: string;
      integrations: (defaults: Integration[]) => Integration[];
    }
  ): unknown;
  captureException(error: unknown): string;
};

export type BrowserErrorTrackingInput = {
  /** NEXT_PUBLIC_SENTRY_DSN, baked in at build time. */
  dsn: string | undefined;
  /** `window`; tests pass an EventTarget. */
  target: EventTarget;
  /** Loads the SDK on the first error. */
  loadSdk: () => Promise<BrowserSentrySdk>;
};

/**
 * Default integrations the browser never runs: sessions and tracing send
 * page views and timings, not errors (the tunnel drops them anyway).
 */
const DROPPED_INTEGRATIONS: ReadonlySet<string> = new Set([
  "BrowserSession",
  "BrowserTracing",
  "Replay",
  "ReplayCanvas",
  "Feedback",
]);

/** Watches for errors and loads Sentry on the first one. */
export function startBrowserErrorTracking({
  dsn,
  target,
  loadSdk,
}: BrowserErrorTrackingInput): void {
  if (!dsn) return;
  const seen: unknown[] = [];
  let loading: Promise<void> | undefined;

  const stop = () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };

  const start = async () => {
    try {
      const [{ errorTracking, sentryOptions }, sdk] = await Promise.all([
        import("./config"),
        loadSdk(),
      ]);
      const tracking = errorTracking({ dsn });
      if (!tracking.enabled) return;
      sdk.init({
        // No hashUserId: the browser never sends a user. The tunnel
        // replaces the environment with the server's APP_ENV.
        ...sentryOptions(tracking),
        tunnel: TUNNEL_PATH,
        integrations: (defaults) =>
          defaults.filter(({ name }) => !DROPPED_INTEGRATIONS.has(name)),
      });
      for (const error of seen.splice(0)) sdk.captureException(error);
    } catch {
      // No SDK, no reports: an error tracker must not cause errors.
    } finally {
      stop();
    }
  };

  const capture = (error: unknown) => {
    seen.push(error);
    loading ??= start();
  };
  function onError(event: Event) {
    capture("error" in event ? event.error : event);
  }
  function onRejection(event: Event) {
    capture("reason" in event ? event.reason : event);
  }

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
}
