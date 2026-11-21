// What use cases run against: the database, the clock and the provider
// ports. `productionDeps()` wires the real ones for server actions and route
// handlers; the Seam 1 harness (src/test/harness.ts) wires PGlite, a fake
// clock and in-memory fakes. Later ports (SMS #58, storage #63) are
// appended here and in the harness by the ticket that adds them. Background
// work is not a port: use cases emit outbox events (src/server/outbox), and
// the relay delivers them with these deps (`h.drain()` in the harness).

import "server-only";

import { env } from "@/env";

import { db } from "./db";
import type { DbWithClock } from "./db/app-db";
import { systemClock } from "./ports/clock";
import type { CookieJar } from "./ports/cookies";
import { nextCookieJar } from "./ports/cookies-next";
import type { EmailSender } from "./ports/email";
import { emailSenderFor } from "./ports/email-sender-for";
import type { ErrorReporter } from "./ports/errors";
import { serverErrorReporter } from "./observability/server-reporter";

export { emailSenderFor } from "./ports/email-sender-for";

export interface Deps extends DbWithClock {
  email: EmailSender;
  /** The response's cookies (the session cookie). */
  cookies: CookieJar;
  /** Better Auth's secret and the site's base URL. */
  auth: { secret: string; baseUrl: string };
  /** Errors a use case catches but can't handle (Sentry, scrubbed). */
  errors: ErrorReporter;
}

/**
 * A local run or a preview without BETTER_AUTH_SECRET signs with this. It is
 * public, so it protects nothing; staging and production must set their own
 * (src/env.schema.ts refuses to start without it).
 */
export const DEVELOPMENT_AUTH_SECRET =
  "foa-development-secret-not-for-staging-or-production";

let production: Deps | undefined;

/** The app's deps, built on first use from `env()`. */
export function productionDeps(): Deps {
  if (!production) {
    const config = env();
    production = {
      db,
      clock: systemClock,
      email: emailSenderFor(config.APP_ENV, { db, clock: systemClock }),
      cookies: nextCookieJar,
      auth: {
        secret: config.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET,
        baseUrl: config.APP_URL,
      },
      // Started by src/instrumentation.ts; silent without a DSN.
      errors: serverErrorReporter,
    };
  }
  return production;
}
