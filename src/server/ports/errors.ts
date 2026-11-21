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

import { createHash } from "node:crypto";

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

/**
 * How long a flush waits by default. A failed request waits this long for
 * its event before Next.js answers (src/server/observability/request-error.ts).
 */
export const DEFAULT_FLUSH_TIMEOUT_MS = 2000;

/** Used whenever error tracking is off: drops every report. */
export const silentErrorReporter: ErrorReporter = {
  report: () => {},
  flush: async () => true,
};

/**
 * A user id as error events carry it: "u_" and the first 32 hex digits of
 * its SHA-256. Ids are UUIDv7s with 74 random bits, so the hash can't be
 * reversed by trying ids, yet an operator can hash a known user's id to
 * find their events in Sentry.
 */
export function hashUserId(id: string): string {
  return `u_${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

/** What an SDK's `captureException` is given for an error's context. */
export type CaptureContext = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id: string };
};

/**
 * The capture context for a report: `where` joins the tags, and the user
 * is already hashed, so the raw id never reaches an SDK.
 */
export function captureContext({
  where,
  tags,
  extra,
  userId,
}: ErrorContext = {}): CaptureContext {
  const allTags = { ...tags, ...(where === undefined ? {} : { where }) };
  return {
    ...(Object.keys(allTags).length > 0 ? { tags: allTags } : {}),
    ...(extra === undefined ? {} : { extra }),
    ...(userId === undefined ? {} : { user: { id: hashUserId(userId) } }),
  };
}
