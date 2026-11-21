// Whether error tracking is on, and the options every Sentry SDK in the
// app starts with (#66). With no DSN it is off, so a local run, CI and
// `next build` need no Sentry secret; with one, every event carries
// APP_ENV as its environment and passes through the scrubber first.
//
// The browser loads this too, so it has no imports beyond the scrubber and
// uses no RegExp lookbehind (scripts/client-bundle.ts).

import { scrubBreadcrumb, scrubEvent, type ScrubOptions } from "./scrub";

/** The parts of a Sentry DSN: `<protocol>://<key>@<host><path>/<project>`. */
export type Dsn = {
  protocol: "http" | "https";
  publicKey: string;
  /** Host name, with the port when there is one. */
  host: string;
  /** Empty, or the path in front of the project id, e.g. "/sentry". */
  path: string;
  projectId: string;
};

/** Reads a DSN, or returns undefined when `value` isn't one. */
export function parseDsn(value: string): Dsn | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const protocol = url.protocol.slice(0, -1);
  if (protocol !== "http" && protocol !== "https") return undefined;
  if (url.username === "" || url.host === "") return undefined;

  const segments = url.pathname.split("/");
  const projectId = segments.pop() ?? "";
  if (!/^\d+$/.test(projectId)) return undefined;

  return {
    protocol,
    publicKey: url.username,
    host: url.host,
    path: segments.join("/"),
    projectId,
  };
}

/** Error tracking as one deployment runs it. */
export type ErrorTracking =
  | { enabled: false }
  | {
      enabled: true;
      dsn: string;
      /** APP_ENV: local, preview, staging or production. */
      environment: string;
      /** The commit the deployment was built from, when known. */
      release?: string;
    };

export type ErrorTrackingInput = {
  /** NEXT_PUBLIC_SENTRY_DSN (app server and browser) or SENTRY_DSN (worker). */
  dsn?: string | undefined;
  /** APP_ENV. Unset means a local run. */
  appEnv?: string | undefined;
  release?: string | undefined;
};

/**
 * On when a DSN is set, off otherwise. Throws on a DSN that is set but
 * malformed, so a typo fails the start instead of silently dropping every
 * error. The message never repeats the value.
 */
export function errorTracking({
  dsn,
  appEnv,
  release,
}: ErrorTrackingInput): ErrorTracking {
  const value = dsn?.trim() ?? "";
  if (value === "") return { enabled: false };
  if (parseDsn(value) === undefined) {
    throw new Error(
      "SENTRY_DSN is set but is not a valid Sentry DSN. Copy it from the " +
        "Sentry project's Client Keys page, or leave it empty to turn " +
        "error tracking off."
    );
  }
  return {
    enabled: true,
    dsn: value,
    environment: appEnv ?? "local",
    ...(release === undefined || release === "" ? {} : { release }),
  };
}

type Scrubbed = <T extends object>(item: T) => T;

/** What `sentryOptions` returns: a subset of every SDK's init options. */
export type SentryOptions = {
  dsn: string;
  environment: string;
  release?: string;
  /** Never attach IPs, cookies, headers or the signed-in user by default. */
  sendDefaultPii: false;
  beforeSend: Scrubbed;
  beforeSendTransaction: Scrubbed;
  beforeBreadcrumb: Scrubbed;
};

/**
 * The init options shared by `@sentry/nextjs` (server and browser) and
 * `@sentry/node` (worker). No `tracesSampleRate`: errors only, no
 * performance tracing, so no request timings or URLs leave as spans.
 * `hashUserId` (src/server/ports/errors.ts) is passed on the server and
 * in the worker; the browser leaves it out and sends no user.
 */
export function sentryOptions(
  tracking: Extract<ErrorTracking, { enabled: true }>,
  scrub: ScrubOptions = {}
): SentryOptions {
  return {
    dsn: tracking.dsn,
    environment: tracking.environment,
    ...(tracking.release === undefined ? {} : { release: tracking.release }),
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event, scrub),
    beforeSendTransaction: (event) => scrubEvent(event, scrub),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  };
}
