// What use cases run against: the database, the clock and the provider
// ports. `productionDeps()` wires the real ones for server actions and route
// handlers; the Seam 1 harness (src/test/harness.ts) wires PGlite, a fake
// clock and in-memory fakes. Later ports (storage #63) are appended here
// and in the harness by the ticket that adds them. Background
// work is not a port: use cases emit outbox events (src/server/outbox), and
// the relay delivers them with these deps (`h.drain()` in the harness).

import "server-only";

import { tmpdir } from "node:os";
import { join } from "node:path";

import { env } from "@/env";
import type { Env, ScannerEnv } from "@/env.schema";
import type { DatabaseEnv } from "@/server/db/database-url";

import type { BlindIndex } from "./crypto/blind-index";
import type { FieldCipher } from "./crypto/field-cipher";
import { fieldCryptoFor } from "./crypto/keys";
import { db } from "./db";
import type { DbWithClock } from "./db/app-db";
import {
  storageBucketFor,
  storagePrefixFor,
} from "./modules/files/domain/storage-key";
import { systemClock } from "./ports/clock";
import type { CookieJar } from "./ports/cookies";
import { nextCookieJar } from "./ports/cookies-next";
import { unconfiguredSmsSender, type SmsSender } from "./ports/sms";
import { captureSmsSender } from "./ports/sms-capture";
import { msg91SmsSender } from "./ports/sms-msg91";
import { fixedSettings, type Settings } from "./ports/settings";
import type { EmailSender } from "./ports/email";
import { emailSenderFor } from "./ports/email-sender-for";
import { unconfiguredStorage, type ObjectStorage } from "./ports/storage";
import {
  diskStorage,
  signingKeyFor,
  type DiskStorage,
} from "./ports/storage-disk";
import { r2Storage, type R2Config } from "./ports/storage-r2";
import type { ErrorReporter } from "./ports/errors";
import type { MalwareScanner } from "./ports/malware-scanner";
import { malwareScannerFor } from "./ports/malware-scanner-clamav";
import { localScanner } from "./ports/malware-scanner-local";
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
 * Production sends real SMS through MSG91 once its keys are set (after
 * FOA's DLT registration); until then it refuses. Every other environment
 * captures, so no real SMS leaves staging, previews or a local run, and
 * MSG91 is never called there.
 */
export function smsSenderFor(
  appEnv: Env["APP_ENV"],
  deps: DbWithClock,
  msg91: { authKey?: string | undefined; otpTemplateId?: string | undefined },
  fetchImpl: typeof fetch = fetch
): SmsSender {
  if (appEnv !== "production") return captureSmsSender(deps);
  if (!msg91.authKey || !msg91.otpTemplateId) return unconfiguredSmsSender;
  return msg91SmsSender(
    {
      authKey: msg91.authKey,
      templates: { "sign-in-code": msg91.otpTemplateId },
    },
    fetchImpl
  );
}

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
  env: StorageEnv & LocalStorageEnv,
  root: string = LOCAL_STORAGE_ROOT
): DiskStorage | null {
  if (env.APP_ENV !== "local" || r2ConfigOf(env)) return null;
  return diskStorage(
    {
      root,
      baseUrl: new URL("/api/local-storage/", env.APP_URL).href,
      // This installation's own random key, never a shared or public one.
      secret: signingKeyFor(root),
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
 * clamd once CLAMD_HOST is set. Without it a local run on the disk store
 * scans with the local scanner, which flags the EICAR test file, and
 * anything else gets one that passes nothing: a deployment (Vercel never
 * reaches clamd, so its uploads wait, unscanned, for the VPS worker, which
 * sets CLAMD_HOST), and a run with R2, whose files are real uploads, even
 * when APP_ENV is left at its default, local.
 */
export function scannerFor(
  env: ScannerEnv & StorageEnv & { APP_ENV: Env["APP_ENV"] }
): MalwareScanner {
  if (!env.CLAMD_HOST && env.APP_ENV === "local" && !r2ConfigOf(env)) {
    return localScanner;
  }
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
      sms: smsSenderFor(
        config.APP_ENV,
        { db, clock: systemClock },
        {
          authKey: config.MSG91_AUTH_KEY,
          otpTemplateId: config.MSG91_OTP_TEMPLATE_ID,
        }
      ),
      cookies: nextCookieJar,
      auth: {
        secret: config.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET,
        baseUrl: config.APP_URL,
      },
      ...fieldCryptoFor(config),
      settings: settingsFor(config.APP_ENV),
      storage: storageFor(config),
      files: filesConfigFor(config),
      // Started by src/instrumentation.ts; silent without a DSN.
      errors: serverErrorReporter,
      scanner: scannerFor(config),
    };
  }
  return production;
}
