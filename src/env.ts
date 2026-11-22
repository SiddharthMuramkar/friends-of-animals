import "server-only";

import type { z } from "zod";

import { buildEnvSchema, envSchema, parseEnv, type Env } from "./env.schema";

let cached: Env | undefined;

/**
 * The server config: process.env parsed with `envSchema` on the first call,
 * then cached. Throws if a required variable is missing or invalid.
 * src/instrumentation.ts calls it as the server starts, so that happens at
 * boot. `next build` has no runtime config, so code that runs while pages
 * are prerendered must not call it.
 */
export function env(): Env {
  cached ??= parseEnv(envSchema, process.env);
  return cached;
}

export type BuildEnv = z.output<typeof buildEnvSchema>;

/**
 * What pages may read while `next build` prerenders them: process.env
 * parsed with `buildEnvSchema`, which needs no database and no secrets.
 */
export function buildEnv(): BuildEnv {
  return parseEnv(buildEnvSchema, process.env);
}

/**
 * Canonical base URL (APP_URL) for metadata and absolute links. Prerendered
 * pages call this during `next build`, so it reads only `buildEnvSchema`.
 */
export function siteUrl(): URL {
  return new URL(buildEnv().APP_URL);
}
