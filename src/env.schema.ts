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

const DEPLOYED_APP_ENVS = ["preview", "staging", "production"] as const;
const APP_ENVS = ["local", ...DEPLOYED_APP_ENVS] as const;

/** What APP_URL is when it is unset, which only `local` allows. */
const LOCAL_APP_URL = "http://localhost:3000";

/** The variables pages may read while `next build` prerenders them. */
const buildVariables = {
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  /** Set to "1" by Vercel, at build time and at runtime. */
  VERCEL: z.string().optional(),
  /**
   * Which deployment this is. Use it for behaviour switches instead of
   * VERCEL_ENV, which can't tell the staging custom environment from preview.
   */
  APP_ENV: z.enum(APP_ENVS).optional(),
  /**
   * Canonical base URL, e.g. https://foa.shipped-it.dev (§13.9). Only the
   * server reads it, so it needs no NEXT_PUBLIC_ prefix, but prerendered
   * pages bake it in at build time.
   */
  APP_URL: z
    .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
    .optional(),
};

type DeploymentVariables = {
  VERCEL?: string | undefined;
  APP_ENV?: (typeof APP_ENVS)[number] | undefined;
  APP_URL?: string | undefined;
};

/**
 * Every deployed environment, all of them on Vercel, must set APP_ENV and
 * APP_URL (§13.9); only a local run may leave them out. So on Vercel (VERCEL
 * set) APP_ENV is required, and any APP_ENV other than `local` requires
 * APP_URL: a deployment never bakes http://localhost:3000 into its pages.
 */
function checkDeployment(
  { VERCEL, APP_ENV, APP_URL }: DeploymentVariables,
  ctx: z.RefinementCtx<DeploymentVariables>
) {
  if (VERCEL !== undefined && APP_ENV === undefined) {
    ctx.issues.push({
      code: "custom",
      path: ["APP_ENV"],
      input: APP_ENV,
      message:
        "APP_ENV is not set. Every Vercel environment must set it to " +
        "preview, staging or production.",
    });
  }
  // An invalid APP_ENV already has its own issue.
  const deployed = DEPLOYED_APP_ENVS.find((name) => name === APP_ENV);
  if (deployed !== undefined && APP_URL === undefined) {
    ctx.issues.push({
      code: "custom",
      path: ["APP_URL"],
      input: APP_URL,
      message:
        `APP_URL is not set. APP_ENV=${deployed} needs its canonical base ` +
        "URL, e.g. https://foa.shipped-it.dev, at build time and at runtime.",
    });
  }
}

/**
 * Run `checkDeployment` even when another variable is invalid, so the error
 * lists every problem at once.
 */
const always = { when: () => true };

/** Fills in the local defaults and drops VERCEL, which nothing else reads. */
function withLocalDefaults<T extends DeploymentVariables>({
  VERCEL: _vercel,
  APP_ENV,
  APP_URL,
  ...rest
}: T) {
  return {
    ...rest,
    APP_ENV: APP_ENV ?? "local",
    APP_URL: APP_URL ?? LOCAL_APP_URL,
  };
}

/**
 * What pages may read while `next build` prerenders them. Outside Vercel
 * nothing here is required, so the build needs no database and no secrets.
 */
export const buildEnvSchema = z
  .object(buildVariables)
  .superRefine(checkDeployment, always)
  .transform(withLocalDefaults);

/**
 * The app server's config, validated when the server starts
 * (src/instrumentation.ts). A missing required variable fails the start.
 */
export const envSchema = z
  .object({
    ...buildVariables,
    /** Runtime connection (PgBouncer in transaction mode on Vercel). */
    DATABASE_URL: postgresUrl(
      "DATABASE_URL is not set. Point it at a Postgres database, e.g. " +
        "postgres://foa:foa@localhost:5432/foa (see .env.example)."
    ),
  })
  .superRefine(checkDeployment, always)
  .transform(withLocalDefaults);

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
