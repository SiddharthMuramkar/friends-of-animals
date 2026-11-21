// The Sentry adapter of the error-reporting port (#66). It takes the SDK
// as an argument, so the app passes `@sentry/nextjs`, the worker passes
// `@sentry/node` (66b), and tests pass a recording stub. Scrubbing happens
// in the SDK's `beforeSend` (`sentryOptions` in
// src/lib/observability/config.ts), which the caller set at `init`.

import {
  DEFAULT_FLUSH_TIMEOUT_MS,
  captureContext,
  type CaptureContext,
  type ErrorReporter,
} from "./errors";

/** The part of a Sentry SDK the adapter uses. */
export type SentrySdk = {
  captureException(error: unknown, hint?: CaptureContext): string;
  flush(timeoutMs?: number): Promise<boolean>;
};

export function sentryErrorReporter(sdk: SentrySdk): ErrorReporter {
  return {
    report(error, context) {
      try {
        sdk.captureException(error, captureContext(context));
      } catch {
        // Reporting must never turn one failure into two.
      }
    },
    async flush(timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS) {
      try {
        return await sdk.flush(timeoutMs);
      } catch {
        return false;
      }
    },
  };
}
