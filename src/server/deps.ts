// What use cases run against: the database, the clock and the provider
// ports. `productionDeps()` wires the real ones for server actions and route
// handlers; the Seam 1 harness (src/test/harness.ts) wires PGlite, a fake
// clock and in-memory fakes. Later ports (SMS #58, storage #63) are
// appended here and in the harness by the ticket that adds them. Background
// work is not a port: use cases emit outbox events (src/server/outbox), and
// the relay delivers them with these deps (`h.drain()` in the harness).

import "server-only";

import { env } from "@/env";
import type { Env } from "@/env.schema";

import { db } from "./db";
import type { DbWithClock } from "./db/app-db";
import { systemClock } from "./ports/clock";
import type { CookieJar } from "./ports/cookies";
import { nextCookieJar } from "./ports/cookies-next";
import { unconfiguredEmailSender, type EmailSender } from "./ports/email";
import { captureEmailSender } from "./ports/email-capture";
import type { HumanCheck } from "./ports/human-check";
import {
  HUMAN_CHECK_DIFFICULTY,
  proofOfWorkHumanCheck,
} from "./modules/public-forms/proof-of-work-check";
import {
  CONTACT_RATE_LIMITS,
  type ContactRateLimits,
} from "./modules/contact/domain/submission";

export interface Deps extends DbWithClock {
  email: EmailSender;
  /** The response's cookies (the session cookie). */
  cookies: CookieJar;
  /** Better Auth's secret and the site's base URL. */
  auth: { secret: string; baseUrl: string };
  /** The human check on public forms (proof of work, signed by the secret). */
  humanCheck: HumanCheck;
}

/**
 * A local run or a preview without BETTER_AUTH_SECRET signs with this. It is
 * public, so it protects nothing; staging and production must set their own
 * (src/env.schema.ts refuses to start without it).
 */
export const DEVELOPMENT_AUTH_SECRET =
  "foa-development-secret-not-for-staging-or-production";

/**
 * Production sends real email (SES, once FOA's account exists; until then
 * it refuses). Every other environment captures, so no real email leaves
 * staging, previews or a local run, and codes stay readable.
 */
export function emailSenderFor(
  appEnv: Env["APP_ENV"],
  deps: DbWithClock
): EmailSender {
  return appEnv === "production"
    ? unconfiguredEmailSender
    : captureEmailSender(deps);
}

export function contactLimitsFor(_appEnv: Env["APP_ENV"]): ContactRateLimits {
  return CONTACT_RATE_LIMITS;
}

let production: Deps | undefined;

/** The app's deps, built on first use from `env()`. */
export function productionDeps(): Deps {
  if (!production) {
    const config = env();
    const secret = config.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET;
    production = {
      db,
      clock: systemClock,
      email: emailSenderFor(config.APP_ENV, { db, clock: systemClock }),
      cookies: nextCookieJar,
      auth: {
        secret,
        baseUrl: config.APP_URL,
      },
      humanCheck: proofOfWorkHumanCheck({
        secret,
        difficulty: HUMAN_CHECK_DIFFICULTY,
      }),
    };
  }
  return production;
}
