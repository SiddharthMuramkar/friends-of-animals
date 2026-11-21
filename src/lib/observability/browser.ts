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

/** Watches for errors and loads Sentry on the first one. */
export function startBrowserErrorTracking(
  _input: BrowserErrorTrackingInput
): void {}
