// The Sentry adapter of the error-reporting port (#66). It takes the SDK
// as an argument, so the app passes `@sentry/nextjs`, the worker passes
// `@sentry/node` (66b), and tests pass a recording stub. Scrubbing happens
// in the SDK's `beforeSend` (`sentryOptions` in
// src/lib/observability/config.ts), which the caller set at `init`.

import type { ErrorReporter } from "./errors";
import { silentErrorReporter } from "./errors";

/** The part of a Sentry SDK the adapter uses. */
export type SentrySdk = {
  captureException(
    error: unknown,
    hint?: {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
      user?: { id: string };
    }
  ): string;
  flush(timeoutMs?: number): Promise<boolean>;
};

export function sentryErrorReporter(_sdk: SentrySdk): ErrorReporter {
  return silentErrorReporter;
}
