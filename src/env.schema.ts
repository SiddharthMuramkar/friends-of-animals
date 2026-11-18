// Environment schemas and the one function that parses them. This module stays
// free of `server-only` and Next.js imports so that code running under plain
// Node (scripts/migrate.ts, drizzle.config.ts) can use it. App code reads its
// config through `env()` from "@/env" instead.

import { z } from "zod";

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: "must be a postgres:// or postgresql:// URL",
});

/** The app's server config. */
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
  /**
   * Canonical base URL, e.g. https://foa.shipped-it.dev (§13.9). Only the
   * server reads it, so it needs no NEXT_PUBLIC_ prefix.
   */
  APP_URL: z
    .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
    .optional(),
});

export type Env = z.output<typeof envSchema>;

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
