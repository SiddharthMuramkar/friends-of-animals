// What use cases run against: the database, the clock and the provider
// ports. `productionDeps()` wires the real ones for server actions and route
// handlers; the Seam 1 harness (src/test/harness.ts) wires PGlite, a fake
// clock and in-memory fakes. Later ports (storage #63) are appended here
// and in the harness by the ticket that adds them. Background
// work is not a port: use cases emit outbox events (src/server/outbox), and
// the relay delivers them with these deps (`h.drain()` in the harness).

import "server-only";

import { env } from "@/env";
import type { Env } from "@/env.schema";

import type { BlindIndex } from "./crypto/blind-index";
import type { FieldCipher } from "./crypto/field-cipher";
import { fieldCryptoFor } from "./crypto/keys";
import { db } from "./db";
import type { DbWithClock } from "./db/app-db";
import { systemClock } from "./ports/clock";
import type { CookieJar } from "./ports/cookies";
import { nextCookieJar } from "./ports/cookies-next";
import type { SmsSender } from "./ports/sms";
import { smsSenderFor } from "./ports/sms-sender-for";
import { fixedSettings, type Settings } from "./ports/settings";
import type { EmailSender } from "./ports/email";
import { emailSenderFor } from "./ports/email-sender-for";
import type { ErrorReporter } from "./ports/errors";
import { serverErrorReporter } from "./observability/server-reporter";

export interface Deps extends DbWithClock {
  email: EmailSender;
  sms: SmsSender;
  /** The response's cookies (the session cookie). */
  cookies: CookieJar;
  /** Better Auth's secret and the site's base URL. */
  auth: { secret: string; baseUrl: string };
  /** Encrypts personal-data columns (a user's phone). */
  cipher: FieldCipher;
  /** Keyed hashes to find rows by an encrypted value. */
  blindIndex: BlindIndex;
  /** Runtime settings, such as whether codes go by SMS. */
  settings: Settings;
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

// Shared with the worker; re-exported for the tests that pin it here.
export { smsSenderFor };

/**
 * The runtime settings each deployment reads until #62's settings table
 * holds them. Local runs and previews send SMS to the capture mailbox, so
 * sign-in by phone is on there (the Seam 2 journey uses it); staging and
 * production keep the default, off, until DLT approval (HR-14).
 */
export function settingsFor(appEnv: Env["APP_ENV"]): Settings {
  return appEnv === "local" || appEnv === "preview"
    ? fixedSettings({ "sms.enabled": true })
    : fixedSettings();
}

let production: Deps | undefined;

/** The app's deps, built on first use from `env()`. */
export function productionDeps(): Deps {
  if (!production) {
    const config = env();
    production = {
      db,
      clock: systemClock,
      email: emailSenderFor(config.APP_ENV, { db, clock: systemClock }),
      sms: smsSenderFor(
        config.APP_ENV,
        { db, clock: systemClock },
        {
          authKey: config.MSG91_AUTH_KEY,
          otpTemplateId: config.MSG91_OTP_TEMPLATE_ID,
          coordinatorInvitationTemplateId:
            config.MSG91_COORDINATOR_INVITATION_TEMPLATE_ID,
        }
      ),
      cookies: nextCookieJar,
      auth: {
        secret: config.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET,
        baseUrl: config.APP_URL,
      },
      ...fieldCryptoFor(config),
      settings: settingsFor(config.APP_ENV),
      // Started by src/instrumentation.ts; silent without a DSN.
      errors: serverErrorReporter,
    };
  }
  return production;
}
