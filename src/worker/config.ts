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
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

import { parseEnv } from "../env.schema";
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
  const env = parseEnv(schema, source);
  const common: Common = {
    appEnv: env.APP_ENV,
    identity: {
      worker: WORKER_NAMES[env.APP_ENV],
      environment: env.APP_ENV,
      version: env.WORKER_VERSION,
    },
    pollMs: env.WORKER_POLL_SECONDS * 1000,
    discoveryMs: env.WORKER_DISCOVERY_SECONDS * 1000,
    connectionsPerDatabase: env.WORKER_CONNECTIONS_PER_DATABASE,
    heartbeatFile: env.WORKER_HEARTBEAT_FILE,
    passwordFile: env.WORKER_PASSWORD_FILE,
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
