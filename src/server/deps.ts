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
import type { DatabaseEnv } from "@/server/db/database-url";

import { db } from "./db";
import type { DbWithClock } from "./db/app-db";
import { storagePrefixFor } from "./modules/files/domain/storage-key";
import { systemClock } from "./ports/clock";
import type { CookieJar } from "./ports/cookies";
import { nextCookieJar } from "./ports/cookies-next";
import { unconfiguredEmailSender, type EmailSender } from "./ports/email";
import { captureEmailSender } from "./ports/email-capture";
import { unconfiguredStorage, type ObjectStorage } from "./ports/storage";
import { r2Storage } from "./ports/storage-r2";

export interface Deps extends DbWithClock {
  email: EmailSender;
  /** The response's cookies (the session cookie). */
  cookies: CookieJar;
  /** Better Auth's secret and the site's base URL. */
  auth: { secret: string; baseUrl: string };
  /** The private buckets uploaded files go to (#63). */
  storage: ObjectStorage;
  files: FilesConfig;
}

/** Where the Files module keeps objects, and for which environment. */
export type FilesConfig = {
  bucket: string;
  /** `storagePrefixFor(env)`: "" in production, else `staging/`, `pr-<n>/`… */
  keyPrefix: string;
  /** Some purposes (test uploads) are refused in production. */
  appEnv: Env["APP_ENV"];
};

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

/** The R2 variables (src/env.schema.ts): all of them, or none. */
export type StorageEnv = {
  R2_ACCOUNT_ID?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  R2_BUCKET?: string | undefined;
};

/**
 * R2 when the deployment has its variables (the schema allows all or
 * none); otherwise storage that refuses every call, so no upload is
 * accepted that couldn't be stored.
 */
export function storageFor(env: StorageEnv): ObjectStorage {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return unconfiguredStorage;
  }
  return r2Storage(
    {
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    systemClock
  );
}

/** The bucket, this environment's key prefix, and the environment. */
export function filesConfigFor(
  env: StorageEnv & DatabaseEnv & { APP_ENV: Env["APP_ENV"] }
): FilesConfig {
  return {
    // Unconfigured storage refuses before a bucket is ever used.
    bucket: env.R2_BUCKET ?? "unconfigured",
    keyPrefix: storagePrefixFor(env),
    appEnv: env.APP_ENV,
  };
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
      cookies: nextCookieJar,
      auth: {
        secret: config.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET,
        baseUrl: config.APP_URL,
      },
      storage: storageFor(config),
      files: filesConfigFor(config),
    };
  }
  return production;
}
