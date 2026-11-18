// Environment schemas and the one function that parses them. This module stays
// free of `server-only` and Next.js imports so that code running under plain
// Node (scripts/migrate.ts, drizzle.config.ts) can use it. App code reads its
// config through `env()` from "@/env" instead.

import { z } from "zod";

/** A postgres:// URL; `whenUnset` is the error shown when it is missing. */
function postgresUrl(whenUnset: string) {
  return z.url({
    protocol: /^postgres(ql)?$/,
    error: (issue) =>
      issue.input === undefined
        ? whenUnset
        : "must be a postgres:// or postgresql:// URL",
  });
}

/**
 * What pages may read while `next build` prerenders them. Nothing here is
 * required, so the build needs no database and no secrets.
 */
export const buildEnvSchema = z.object({
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
   * Canonical base URL, e.g. https://foa.shipped-it.dev (§13.9). Only the
   * server reads it, so it needs no NEXT_PUBLIC_ prefix, but prerendered
   * pages bake it in at build time.
   */
  APP_URL: z
    .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
    .default("http://localhost:3000"),
});

/**
 * The app server's config, validated when the server starts
 * (src/instrumentation.ts). A missing required variable fails the start.
 */
export const envSchema = buildEnvSchema.extend({
  /** Runtime connection (PgBouncer in transaction mode on Vercel). */
  DATABASE_URL: postgresUrl(
    "DATABASE_URL is not set. Point it at a Postgres database, e.g. " +
      "postgres://foa:foa@localhost:5432/foa (see .env.example)."
  ),
});

export type Env = z.output<typeof envSchema>;

/**
 * What the migration script and drizzle-kit read. They connect through
 * DIRECT_URL only, a direct or session-mode connection (§2.2): DATABASE_URL
 * may be the transaction-mode pooler, so it is never a fallback.
 */
export const migrationEnvSchema = z.object({
  DIRECT_URL: postgresUrl(
    "DIRECT_URL is not set. Migrations and drizzle-kit connect through it, " +
      "never through DATABASE_URL. Locally it is the same URL as " +
      "DATABASE_URL, e.g. postgres://foa:foa@localhost:5432/foa (see " +
      ".env.example)."
  ),
});

/**
 * Parses an env-like object, usually process.env, against `schema`. Empty
 * strings count as unset, so `FOO=` in a .env file behaves like a missing
 * variable. Throws one readable error that lists every problem.
 */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined>
): z.output<Schema> {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(
      ([, value]) => value !== undefined && value !== ""
    )
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`
    );
  }
  return result.data;
}
