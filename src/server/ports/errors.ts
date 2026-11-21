// The error-reporting port (#66). Code that catches an error it can't
// handle reports it here and never talks to Sentry directly. Adapters:
//   - Sentry (./errors-sentry.ts): `@sentry/nextjs` in the app, and
//     `@sentry/node` in the worker (66b).
//   - silent (`silentErrorReporter`): whenever no DSN is set, so local runs,
//     CI and tests never import an SDK.
//   - the in-memory fake (src/test/fakes/errors.ts): Seam 1 tests.
// Every adapter passes ./errors.contract.ts.
//
// Plain Node: no `server-only`, no "@/env", so the worker can import it.

/** What an error report may carry besides the error itself. */
export type ErrorContext = {
  /** Where it was caught, e.g. "onRequestError"; sent as the `where` tag. */
  where?: string;
  /** Searchable labels, e.g. the route path. Scrubbed before sending. */
  tags?: Record<string, string>;
  /** Anything else worth seeing. Scrubbed before sending. */
  extra?: Record<string, unknown>;
  /** The signed-in user's id; only its hash (`hashUserId`) leaves. */
  userId?: string;
};

export interface ErrorReporter {
  /** Records one error. Never throws, never awaits the network. */
  report(error: unknown, context?: ErrorContext): void;
  /** Waits up to timeoutMs for queued events; false if some were not sent. */
  flush(timeoutMs?: number): Promise<boolean>;
}

/** Used whenever error tracking is off: drops every report. */
export const silentErrorReporter: ErrorReporter = {
  report: () => {},
  flush: async () => false,
};

/** A user id as error events carry it. */
export function hashUserId(_id: string): string {
  return "";
}
