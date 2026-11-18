import "server-only";

import { z } from "zod";

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: "must be a postgres:// or postgresql:// URL",
});

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  /**
   * Which deployment this is. Use it for behaviour switches instead of
   * VERCEL_ENV, which can't tell the staging custom environment from preview.
   */
  APP_ENV: z
    .enum(["local", "preview", "staging", "production"])
    .default("local"),
  /**
   * Runtime connection (PgBouncer in transaction mode on Vercel). Optional
   * here so `next build` works without a database; `databaseUrl()` enforces
   * it when the database is actually used.
   */
  DATABASE_URL: postgresUrl.optional(),
  /** Direct (session-mode) connection for migrations and drizzle-kit. */
  DIRECT_URL: postgresUrl.optional(),
  /** Public origin, e.g. https://foa.shipped-it.dev. Used for absolute URLs. */
  NEXT_PUBLIC_SITE_URL: z
    .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
    .optional(),
});

export type Env = z.output<typeof envSchema>;

/** Parse an env-like object. Throws a readable error on invalid config. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so `FOO=` in .env behaves like missing.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== "")
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`
    );
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Lazily parsed, cached server config. Importing this module never throws;
 * the first call to `env()` validates process.env.
 */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test helper: clear the cache so the next `env()` re-reads process.env. */
export function resetEnvCache() {
  cached = undefined;
}

/** The runtime database URL. Throws if DATABASE_URL is not set. */
export function databaseUrl(config: Env = env()): string {
  if (!config.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Point it at a Postgres database, e.g. " +
        "postgres://foa:foa@localhost:5432/foa (see .env.example)."
    );
  }
  return config.DATABASE_URL;
}

/** Absolute site origin for metadata and links; localhost when unset. */
export function siteUrl(config: Env = env()): URL {
  return new URL(config.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
}
