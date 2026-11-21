// What use cases run against: the database, the clock and the provider
// ports. `productionDeps()` wires the real ones for server actions and route
// handlers; the Seam 1 harness (src/test/harness.ts) wires PGlite, a fake
// clock and in-memory fakes. Later ports (SMS #58, storage #63) are
// appended here and in the harness by the ticket that adds them. Background
// work is not a port: use cases emit outbox events (src/server/outbox), and
// the relay delivers them with these deps (`h.drain()` in the harness).

import "server-only";

import { tmpdir } from "node:os";
import { join } from "node:path";

import { env } from "@/env";
import type { Env, ScannerEnv } from "@/env.schema";
import type { DatabaseEnv } from "@/server/db/database-url";

import { db } from "./db";
import type { DbWithClock } from "./db/app-db";
import {
  storageBucketFor,
  storagePrefixFor,
} from "./modules/files/domain/storage-key";
import { systemClock } from "./ports/clock";
import type { CookieJar } from "./ports/cookies";
import { nextCookieJar } from "./ports/cookies-next";
import { unconfiguredEmailSender, type EmailSender } from "./ports/email";
import { captureEmailSender } from "./ports/email-capture";
import { unconfiguredStorage, type ObjectStorage } from "./ports/storage";
import { diskStorage, type DiskStorage } from "./ports/storage-disk";
import { r2Storage, type R2Config } from "./ports/storage-r2";
import type { ErrorReporter } from "./ports/errors";
import type { MalwareScanner } from "./ports/malware-scanner";
import { malwareScannerFor } from "./ports/malware-scanner-clamav";
import { localScanner } from "./ports/malware-scanner-local";
import { serverErrorReporter } from "./observability/server-reporter";

export interface Deps extends DbWithClock {
  email: EmailSender;
  /** The response's cookies (the session cookie). */
  cookies: CookieJar;
  /** Better Auth's secret and the site's base URL. */
  auth: { secret: string; baseUrl: string };
  /** The private buckets uploaded files go to (#63). */
  storage: ObjectStorage;
  files: FilesConfig;
  /** Errors a use case catches but can't handle (Sentry, scrubbed). */
  errors: ErrorReporter;
  /** Scans each upload before anyone but its uploader may open it (#63). */
  scanner: MalwareScanner;
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

/** What a local run's disk store needs as well: the run and the app. */
export type LocalStorageEnv = {
  APP_ENV: Env["APP_ENV"];
  /** The app's base URL, where the disk store's signed URLs point. */
  APP_URL: string;
  BETTER_AUTH_SECRET?: string | undefined;
};

function r2ConfigOf({
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
}: StorageEnv): R2Config | null {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return null;
  }
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
}

/**
 * R2 when the variables are set (the schema allows all or none). Without
 * them a local run keeps its files on this machine (`localDiskStorageFor`),
 * and a deployment gets storage that refuses every call, so no upload is
 * accepted that couldn't be stored.
 */
export function storageFor(env: StorageEnv & LocalStorageEnv): ObjectStorage {
  const r2 = r2ConfigOf(env);
  if (r2) return r2Storage(r2, systemClock);
  return localDiskStorageFor(env) ?? unconfiguredStorage;
}

/** Where a local run's disk store keeps files: outside any worktree. */
export const LOCAL_STORAGE_ROOT = join(tmpdir(), "foa-local-storage");

/**
 * A local run's storage while R2 isn't configured, as on a laptop and in
 * CI's E2E job: files on this machine's disk, uploaded and fetched through
 * signed URLs on the app's own route (src/app/api/local-storage). Null for
 * every deployment, and for a local run with R2: that route answers 404.
 */
export function localDiskStorageFor(
  env: StorageEnv & LocalStorageEnv
): DiskStorage | null {
  if (env.APP_ENV !== "local" || r2ConfigOf(env)) return null;
  return diskStorage(
    {
      root: LOCAL_STORAGE_ROOT,
      baseUrl: new URL("/api/local-storage/", env.APP_URL).href,
      secret: env.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET,
    },
    systemClock
  );
}

/** The bucket, this environment's key prefix, and the environment. */
export function filesConfigFor(
  env: StorageEnv & DatabaseEnv & { APP_ENV: Env["APP_ENV"] }
): FilesConfig {
  return {
    bucket: storageBucketFor(env),
    keyPrefix: storagePrefixFor(env),
    appEnv: env.APP_ENV,
  };
}

/**
 * clamd once CLAMD_HOST is set. Without it a local run scans with the
 * local scanner, which flags the EICAR test file, and a deployment gets one
 * that passes nothing: Vercel never reaches clamd, so its uploads wait,
 * unscanned, for the VPS worker, which sets CLAMD_HOST.
 */
export function scannerFor(
  env: ScannerEnv & { APP_ENV: Env["APP_ENV"] }
): MalwareScanner {
  if (!env.CLAMD_HOST && env.APP_ENV === "local") return localScanner;
  return malwareScannerFor(env);
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
      // Started by src/instrumentation.ts; silent without a DSN.
      errors: serverErrorReporter,
      scanner: scannerFor(config),
    };
  }
  return production;
}
