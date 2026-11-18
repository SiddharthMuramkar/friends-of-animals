import "server-only";

import { envSchema, parseEnv, type Env } from "./env.schema";

let cached: Env | undefined;

/**
 * The server config: process.env, parsed with `envSchema` on the first call
 * and cached. Importing this module never throws.
 */
export function env(): Env {
  cached ??= parseEnv(envSchema, process.env);
  return cached;
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
  return new URL(config.APP_URL ?? "http://localhost:3000");
}
