// What use cases run against: the database, the clock and the provider
// ports. `productionDeps()` wires the real ones for server actions and route
// handlers; the Seam 1 harness (src/test/harness.ts) wires PGlite, a fake
// clock and in-memory fakes. Later ports (storage #63) are appended here
// and in the harness by the ticket that adds them. Background
// work is not a port: use cases emit outbox events (src/server/outbox), and
// the relay delivers them with these deps (`h.drain()` in the harness).

import "server-only";

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
import type { SmsSender } from "./ports/sms";
import { smsSenderFor } from "./ports/sms-sender-for";
import type { SettingKey, SettingValue, Settings } from "./ports/settings";
import { databaseSettings } from "./modules/settings/read";
import type { EmailSender } from "./ports/email";
import {
  emailSenderFor,
  sesConfigOf,
  type SesVariables,
} from "./ports/email-sender-for";
import {
  CODE_REQUEST_LIMITS,
  type CodeRequestLimits,
  DEVELOPMENT_AUTH_SECRET,
} from "./identity/settings";
import type { ObjectStorage } from "./ports/storage";
import { r2ConfigOf, storageFor, type StorageEnv } from "./ports/storage-for";
import type { ErrorReporter } from "./ports/errors";
import type { MalwareScanner } from "./ports/malware-scanner";
import { malwareScannerFor } from "./ports/malware-scanner-clamav";
import { localScanner } from "./ports/malware-scanner-local";
import { unconfiguredPdfRenderer, type PdfRenderer } from "./ports/pdf";
import { noStoreCdnPurger, type CdnPurger } from "./ports/cdn-purger";
import { unconfiguredMedia, type MediaProcessor } from "./ports/media";
import type { PaymentGateway } from "./ports/payment-gateway";
import { paymentGatewayFor } from "./ports/payment-gateway-select";
import { serverErrorReporter } from "./observability/server-reporter";
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
  appEnv: Env["APP_ENV"];
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
  /**
   * Runtime settings a super admin changes without a deploy, such as
   * whether codes go by SMS (#62).
   */
  settings: Settings;
  /** The private buckets uploaded files go to (#63). */
  storage: ObjectStorage;
  files: FilesConfig;
  /** Errors a use case catches but can't handle (Sentry, scrubbed). */
  errors: ErrorReporter;
  /** Scans each upload before anyone but its uploader may open it (#63). */
  scanner: MalwareScanner;
  /** Processes derivatives on the media queue in worker-media. */
  media: MediaProcessor;
  pdf: PdfRenderer;
  cdn: CdnPurger;
  /** The human check on public forms (proof of work, signed by the secret). */
  humanCheck: HumanCheck;
  /** The contact form's limits per IP and per address. */
  contactLimits: ContactRateLimits;
  /** The sign-in code limits per address or phone, and per IP. */
  codeRequestLimits: CodeRequestLimits;
  /** Takes fee payments: orders, Checkout and webhooks (#77). */
  payments: PaymentGateway;
}

export { DEVELOPMENT_AUTH_SECRET };
/** Where the Files module keeps objects, and for which environment. */
export type FilesConfig = {
  bucket: string;
  /** `storagePrefixFor(env)`: "" in production, else `staging/`, `pr-<n>/`… */
  keyPrefix: string;
  /** Some purposes (test uploads) are refused in production. */
  appEnv: Env["APP_ENV"];
  /**
   * Where browsers load the public bucket's objects, ending in "/"; null
   * while it has no domain, so the public site shows no uploaded image.
   */
  publicBaseUrl: string | null;
};

// Which SMS adapter an environment uses: shared with the VPS worker,
// which sends messages the same way (#69).
export { smsSenderFor, storageFor };
export {
  LOCAL_STORAGE_ROOT,
  localDiskStorageFor,
  type LocalStorageEnv,
  type StorageEnv,
} from "./ports/storage-for";

/** The bucket, this environment's key prefix, and the environment. */
export function filesConfigFor(
  env: StorageEnv & DatabaseEnv & { APP_ENV: Env["APP_ENV"] }
): FilesConfig {
  return {
    bucket: storageBucketFor(env),
    keyPrefix: storagePrefixFor(env),
    appEnv: env.APP_ENV,
    publicBaseUrl: env.PUBLIC_ASSET_BASE_URL
      ? env.PUBLIC_ASSET_BASE_URL.replace(/\/*$/, "/")
      : null,
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

/**
 * Whether sign-in by emailed code can work here. Every environment but
 * production captures email, so it can. Production needs SES configured
 * and out of its sandbox (SES_PRODUCTION_ACCESS, set by infra once AWS
 * approves): in the sandbox SES only sends to verified addresses, so a
 * new visitor's code would never arrive (DECISIONS R-27, HR-12).
 */
export function emailSignInReady(
  env: SesVariables & {
    APP_ENV: Env["APP_ENV"];
    SES_PRODUCTION_ACCESS: boolean;
  }
): boolean {
  if (env.APP_ENV !== "production") return true;
  return sesConfigOf(env) !== null && env.SES_PRODUCTION_ACCESS;
}

/**
 * The runtime settings use cases read: `settings`, except that email
 * sign-in (`auth.emailSignIn`) stays off while it can't work here, however
 * it is switched. Switching it off works everywhere.
 */
export function settingsFor(
  settings: Settings,
  { emailSignInReady: ready }: { emailSignInReady: boolean }
): Settings {
  if (ready) return settings;
  return {
    async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
      if (key === "auth.emailSignIn") return false as SettingValue<K>;
      return settings.get(key);
    },
  };
}

/**
 * The contact form's limits until #62's settings hold them (HR-51). Local
 * runs and previews let one IP send many more: every E2E run reaches a
 * preview from the CI runner's one address.
 */
export function contactLimitsFor(appEnv: Env["APP_ENV"]): ContactRateLimits {
  return appEnv === "local" || appEnv === "preview"
    ? { ...CONTACT_RATE_LIMITS, perIpPerHour: 100 }
    : CONTACT_RATE_LIMITS;
}

/**
 * The sign-in code limits (HR-19). Local runs and previews let one IP ask
 * for many more codes: every E2E run asks from the CI runner's one
 * address, and a shard signs in more than 20 times in 15 minutes.
 * Staging and production keep FOA's 20.
 */
export function codeRequestLimitsFor(
  appEnv: Env["APP_ENV"]
): CodeRequestLimits {
  return appEnv === "local" || appEnv === "preview"
    ? { ...CODE_REQUEST_LIMITS, perIp: 200 }
    : CODE_REQUEST_LIMITS;
}

let production: Deps | undefined;

/** The app's deps, built on first use from `env()`. */
export function productionDeps(): Deps {
  if (!production) {
    const config = env();
    const secret = config.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET;
    production = {
      appEnv: config.APP_ENV,
      db,
      clock: systemClock,
      email: emailSenderFor(config.APP_ENV, { db, clock: systemClock }, config),
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
        secret,
        baseUrl: config.APP_URL,
      },
      ...fieldCryptoFor(config),
      storage: storageFor(config),
      files: filesConfigFor(config),
      // The settings table, read on every call (#62), with email sign-in
      // held off until SES can send it (R-27).
      settings: settingsFor(databaseSettings(db), {
        emailSignInReady: emailSignInReady(config),
      }),
      humanCheck: proofOfWorkHumanCheck({
        secret,
        difficulty: HUMAN_CHECK_DIFFICULTY,
      }),
      contactLimits: contactLimitsFor(config.APP_ENV),
      codeRequestLimits: codeRequestLimitsFor(config.APP_ENV),
      // Started by src/instrumentation.ts; silent without a DSN.
      errors: serverErrorReporter,
      scanner: scannerFor(config),
      media: unconfiguredMedia,
      pdf: unconfiguredPdfRenderer,
      cdn: noStoreCdnPurger,
      // Razorpay where its keys are set (live in production, test
      // elsewhere), the test checkout's fallback where none are, and a
      // gateway that refuses every payment in production without live keys.
      payments: paymentGatewayFor(config, { db, clock: systemClock }),
    };
  }
  return production;
}
