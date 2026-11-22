// The worker's configuration, from its environment (docker/workers.yml sets
// it per service; `pnpm worker:dev` reads .env like the other scripts).
//
//   WORKER_MODE                      single (default) | preview
//   APP_ENV                          local | preview | staging | production
//   WORKER_DATABASE_URL              single: the one database, connected to
//                                    directly (not through PgBouncer). A local
//                                    run falls back to DIRECT_URL.
//   WORKER_ADMIN_URL                 preview: pg-nonprod's `postgres`
//                                    database, where previews are listed; each
//                                    preview is reached by swapping the path
//   WORKER_POLL_SECONDS              5: how often each database is drained
//   WORKER_DISCOVERY_SECONDS         60: how often previews are listed
//   WORKER_CONNECTIONS_PER_DATABASE  1 (at most 2): pg-nonprod is shared by
//                                    every preview (docker/README.md)
//   WORKER_HEARTBEAT_FILE            /tmp/foa-worker-heartbeat: touched while
//                                    healthy; the Compose health check reads it
//   WORKER_VERSION                   dev: the commit the image was built from
//   WORKER_PASSWORD_FILE             a file holding the role's password (a
//                                    Compose secret), for a URL without one
//   SENTRY_DSN                       the workers' Sentry project (#66); unset
//                                    turns error tracking off (./errors.ts)
//   WORKER_QUEUE                     default | media: which outbox queue it
//                                    drains (src/server/outbox/queues.ts).
//                                    media is worker-media (#85): image
//                                    derivatives only, one delivery at a time
//   MEDIA_TIMEOUT_SECONDS            60 (at most 240): media only, the time one
//                                    image's processing may take before the
//                                    job fails as media_timeout
//   APP_URL                          the site's base URL, for links in messages
//                                    (#74's invitations); a local run falls back
//                                    to http://localhost:3000
//   FIELD_ENCRYPTION_KEYS            the app's field cipher key ring and blind
//   FIELD_HMAC_KEY                   index key (#58), to read what a message
//                                    sends to (an invitee's address, a stored
//                                    phone); without them staging and
//                                    production can't, and such a delivery
//                                    fails until they are set. worker-prod
//                                    reads the production app's from its own
//                                    env file (docker/README.md, "Links and
//                                    field keys")
//
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, the bucket the malware scan reads uploads
//   R2_SECRET_ACCESS_KEY, R2_BUCKET  from (#63): all four or none; without
//                                    them every scan fails and files wait
//   CLAMD_HOST, CLAMD_PORT           clamd (3310), which the scan asks; without
//                                    a host every scan fails and files wait
//   RAZORPAY_KEY_ID,                 the app's Razorpay keys, all three or none,
//   RAZORPAY_KEY_SECRET,             to send approved refunds (#80). Without
//   RAZORPAY_WEBHOOK_SECRET          them production's worker refuses each
//                                    refund (it retries), and other
//                                    environments refund through the fallback
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

import {
  fieldKey,
  LOCAL_APP_URL,
  parseEnv,
  refundJobEnvSchema,
  scanJobEnvSchema,
  type ScannerEnv,
} from "../env.schema";
import { parseDsn } from "../lib/observability/config";
import type { R2Config } from "../server/ports/storage-r2";
import { parseBlindIndexKey } from "../server/crypto/blind-index";
import { parseKeyRing } from "../server/crypto/field-cipher";
import type { WorkerIdentity } from "./tenant";

type Common = {
  appEnv: WorkerIdentity["environment"];
  identity: WorkerIdentity;
  /** Between ticks. */
  pollMs: number;
  /** Between listings of the preview databases. */
  discoveryMs: number;
  /** The pool size of each database's client. */
  connectionsPerDatabase: number;
  heartbeatFile: string;
  /** Read at start and put into the URL with `withPassword`. */
  passwordFile: string | undefined;
  /** Where errors go; unset, nowhere. */
  sentryDsn: string | undefined;
  /** R2, where the malware scan reads uploads; unset, every scan fails. */
  r2: R2Config | undefined;
  /** clamd, which the malware scan asks; without a host every scan fails. */
  clamd: ScannerEnv;
  queue: WorkerQueue;
  /** The site's base URL, for links in messages; unset, none. */
  siteUrl: string | undefined;
  /** The app's field keys (FIELD_ENCRYPTION_KEYS, FIELD_HMAC_KEY). */
  fieldEncryptionKeys: string | undefined;
  fieldHmacKey: string | undefined;
  /** Razorpay's keys, to send refunds (#80); absent, none are set. */
  razorpay?: { keyId: string; keySecret: string; webhookSecret: string };
};

/**
 * The outbox queue a worker drains. The default workers run every handler
 * but the dedicated queues'; worker-media runs the media queue alone.
 */
export type WorkerQueue =
  | { name: "default" }
  | {
      name: "media";
      /** The most one image's processing may take (media_timeout). */
      timeoutSeconds: number;
    };

export type WorkerConfig =
  | (Common & {
      mode: "single";
      databaseUrl: string;
      /** The database's name, from the URL. */
      database: string;
    })
  | (Common & { mode: "preview"; adminUrl: string });

const WORKER_NAMES = {
  production: "worker-prod",
  staging: "worker-staging",
  preview: "worker-preview",
  local: "worker-local",
} as const satisfies Record<WorkerIdentity["environment"], string>;

/** worker-media in production, as in docker/workers.yml. */
const MEDIA_WORKER_NAMES = {
  production: "worker-media",
  staging: "worker-media-staging",
  preview: "worker-media-preview",
  local: "worker-media-local",
} as const satisfies Record<WorkerIdentity["environment"], string>;

/**
 * The longest a media job may take: the relay's lease is 5 minutes
 * (DEFAULT_RETRY_POLICY.leaseMs), and the job reads the original and
 * writes its derivatives inside it too.
 */
const MAX_MEDIA_TIMEOUT_SECONDS = 240;

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: "must be a postgres:// or postgresql:// URL",
});

const seconds = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

const schema = z
  .object({
    WORKER_MODE: z.enum(["single", "preview"]).default("single"),
    APP_ENV: z.enum(["local", "preview", "staging", "production"]),
    WORKER_DATABASE_URL: postgresUrl.optional(),
    DIRECT_URL: postgresUrl.optional(),
    WORKER_ADMIN_URL: postgresUrl.optional(),
    WORKER_POLL_SECONDS: seconds(5, 300),
    WORKER_DISCOVERY_SECONDS: seconds(60, 3600),
    WORKER_CONNECTIONS_PER_DATABASE: z.coerce
      .number()
      .int()
      .min(1)
      .max(2, { error: "at most 2: pg-nonprod is shared by every preview" })
      .default(1),
    WORKER_HEARTBEAT_FILE: z.string().default("/tmp/foa-worker-heartbeat"),
    WORKER_VERSION: z.string().default("dev"),
    WORKER_PASSWORD_FILE: z.string().optional(),
    WORKER_QUEUE: z.enum(["default", "media"]).default("default"),
    MEDIA_TIMEOUT_SECONDS: seconds(60, MAX_MEDIA_TIMEOUT_SECONDS),
    SENTRY_DSN: z
      .string()
      .refine((value) => parseDsn(value) !== undefined, {
        error:
          "is not a valid Sentry DSN. Copy it from the Sentry project's " +
          "Client Keys page, or leave it empty to turn error tracking off.",
      })
      .optional(),
    APP_URL: z
      .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
      .optional(),
    FIELD_ENCRYPTION_KEYS: fieldKey(parseKeyRing),
    FIELD_HMAC_KEY: fieldKey(parseBlindIndexKey),
  })
  .superRefine((env, ctx) => {
    if (env.WORKER_MODE === "preview") {
      if (env.APP_ENV !== "preview") {
        ctx.addIssue({
          code: "custom",
          path: ["APP_ENV"],
          message: "must be preview when WORKER_MODE is preview",
        });
      }
      if (env.WORKER_ADMIN_URL === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["WORKER_ADMIN_URL"],
          message: "is required when WORKER_MODE is preview",
        });
      }
      return;
    }
    if (env.APP_ENV === "preview") {
      ctx.addIssue({
        code: "custom",
        path: ["WORKER_MODE"],
        message: "must be preview when APP_ENV is preview",
      });
    }
    const fallback = env.APP_ENV === "local" ? env.DIRECT_URL : undefined;
    if ((env.WORKER_DATABASE_URL ?? fallback) === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["WORKER_DATABASE_URL"],
        message:
          env.APP_ENV === "local"
            ? "is required (or DIRECT_URL) when WORKER_MODE is single"
            : "is required when WORKER_MODE is single",
      });
    }
  });

/** Parses the worker's variables; throws one error naming every problem. */
export function workerConfig(
  source: Record<string, string | undefined>
): WorkerConfig {
  const env = parseEnv(
    z.intersection(
      z.intersection(schema, scanJobEnvSchema),
      refundJobEnvSchema
    ),
    source
  );
  const media = env.WORKER_QUEUE === "media";
  const common: Common = {
    appEnv: env.APP_ENV,
    identity: {
      worker: (media ? MEDIA_WORKER_NAMES : WORKER_NAMES)[env.APP_ENV],
      environment: env.APP_ENV,
      version: env.WORKER_VERSION,
    },
    pollMs: env.WORKER_POLL_SECONDS * 1000,
    discoveryMs: env.WORKER_DISCOVERY_SECONDS * 1000,
    connectionsPerDatabase: env.WORKER_CONNECTIONS_PER_DATABASE,
    heartbeatFile: env.WORKER_HEARTBEAT_FILE,
    passwordFile: env.WORKER_PASSWORD_FILE,
    sentryDsn: env.SENTRY_DSN,
    queue: media
      ? { name: "media", timeoutSeconds: env.MEDIA_TIMEOUT_SECONDS }
      : { name: "default" },
    // The schema takes all four R2 variables or none.
    r2:
      env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
        ? {
            accountId: env.R2_ACCOUNT_ID,
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          }
        : undefined,
    clamd: { CLAMD_HOST: env.CLAMD_HOST, CLAMD_PORT: env.CLAMD_PORT },
    siteUrl:
      env.APP_URL ?? (env.APP_ENV === "local" ? LOCAL_APP_URL : undefined),
    fieldEncryptionKeys: env.FIELD_ENCRYPTION_KEYS,
    fieldHmacKey: env.FIELD_HMAC_KEY,
    // The schema takes all three Razorpay variables or none.
    ...(env.RAZORPAY_KEY_ID &&
    env.RAZORPAY_KEY_SECRET &&
    env.RAZORPAY_WEBHOOK_SECRET
      ? {
          razorpay: {
            keyId: env.RAZORPAY_KEY_ID,
            keySecret: env.RAZORPAY_KEY_SECRET,
            webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
          },
        }
      : {}),
  };
  if (env.WORKER_MODE === "preview") {
    // The refinement above guarantees it.
    return { ...common, mode: "preview", adminUrl: env.WORKER_ADMIN_URL! };
  }
  const databaseUrl = (env.WORKER_DATABASE_URL ?? env.DIRECT_URL)!;
  return {
    ...common,
    mode: "single",
    databaseUrl,
    database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)),
  };
}

/** `url` logging in with `password`. */
function urlWithPassword(url: string, password: string): string {
  const parsed = new URL(url);
  parsed.password = encodeURIComponent(password);
  return parsed.href;
}

/**
 * `config` with `password` (a secret file's content, trailing newline
 * dropped) in its connection URL. Compose hands secrets over as files,
 * never as environment values, so the URLs in docker/workers.yml carry
 * none.
 */
export function withPassword(
  config: WorkerConfig,
  password: string
): WorkerConfig {
  const secret = password.replace(/\r?\n$/, "");
  return config.mode === "single"
    ? { ...config, databaseUrl: urlWithPassword(config.databaseUrl, secret) }
    : { ...config, adminUrl: urlWithPassword(config.adminUrl, secret) };
}
