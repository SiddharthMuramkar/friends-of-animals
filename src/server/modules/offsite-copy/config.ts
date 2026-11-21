// What the off-site copy runs with, read from the worker's environment
// (worker-prod's variables in docker/README.md). Production with missing or
// wrong settings is not "no backups, quietly": the run fails and reports
// each problem by variable name, never by value.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import { readFileSync } from "node:fs";

import { z } from "zod";

import type { S3BucketConfig } from "../../ports/copy-bucket-s3";
import type { RetentionWindow } from "./domain/plan";

export const APP_ENVS = ["local", "preview", "staging", "production"] as const;

export type AppEnv = (typeof APP_ENVS)[number];

export type OffsiteConfig = {
  /** Only production copies anything. */
  appEnv: AppEnv;
  /** The R2 buckets to copy from: production's, never a shared one. */
  sourceBuckets: readonly string[];
  /** The one B2 bucket every copy goes to, under `<source bucket>/`. */
  targetBucket: string;
  retention: RetentionWindow;
  /** No new copy starts this long after the run started. */
  budgetMs: number;
  /** How many copies stream at once. */
  concurrency: number;
};

type Env = Record<string, string | undefined>;

export type OffsiteSettings =
  | { kind: "not_production"; appEnv: Exclude<AppEnv, "production"> }
  | { kind: "invalid"; problems: string[] }
  | {
      kind: "ready";
      config: OffsiteConfig;
      /** R2, with the read-only key. */
      r2: S3BucketConfig;
      b2: S3BucketConfig;
    };

export type RestoreSettings =
  | {
      ok: true;
      /** The B2 bucket the copies are in. */
      targetBucket: string;
      /** R2, with the operator's key that may write. */
      r2: S3BucketConfig;
      b2: S3BucketConfig;
    }
  | { ok: false; problems: string[] };

const DEFAULT_RETENTION_DAYS = 30;
/** The nightly window: 01:30 to 03:30 IST, clear of the 02:30 backup's load. */
const RUN_BUDGET_MS = 2 * 60 * 60 * 1000;
const COPY_CONCURRENCY = 4;

const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const BUCKET_LIST_ERROR =
  "must list bucket names (3-63 of a-z, 0-9 and -), separated by commas";
const RETENTION_ERROR = "must be a whole number of days from 1 to 3650";

const schemas = {
  bucketList: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "")
    )
    .pipe(
      z
        .array(z.string().regex(BUCKET_NAME, { error: BUCKET_LIST_ERROR }))
        .min(1, { error: BUCKET_LIST_ERROR })
    ),
  bucket: z.string().regex(BUCKET_NAME, {
    error: "must be a bucket name (3-63 of a-z, 0-9 and -)",
  }),
  days: z
    .string()
    .regex(/^[0-9]+$/, { error: RETENTION_ERROR })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(1, { error: RETENTION_ERROR })
        .max(3650, { error: RETENTION_ERROR })
    ),
  accountId: z.string().regex(/^[0-9a-f]{32}$/, {
    error: "must be 32 lower-case hex characters",
  }),
  httpsUrl: z.url({ protocol: /^https$/, error: "must be an https URL" }),
  text: z.string(),
};

/**
 * Collects each variable's problem in `problems`, by name only: a value
 * may be a secret, so no message repeats it.
 */
class EnvReader {
  readonly problems: string[] = [];

  constructor(private readonly env: Env) {}

  /**
   * The variable's value, trimmed, or else the contents of the file
   * `<name>_FILE` names (a Compose secret). Empty counts as unset.
   */
  raw(name: string): string | undefined {
    const value = this.env[name]?.trim() || undefined;
    const file = this.env[`${name}_FILE`]?.trim() || undefined;
    if (value !== undefined || file === undefined) return value;
    try {
      return readFileSync(file, "utf8").trim() || undefined;
    } catch {
      this.problems.push(`${name}_FILE names a file that can't be read`);
      return undefined;
    }
  }

  required<T>(name: string, schema: z.ZodType<T, string>): T | undefined {
    const problems = this.problems.length;
    const value = this.raw(name);
    if (value === undefined) {
      if (this.problems.length === problems) {
        this.problems.push(`${name} is not set`);
      }
      return undefined;
    }
    return this.#parse(name, schema, value);
  }

  optional<T>(
    name: string,
    schema: z.ZodType<T, string>,
    fallback: T
  ): T | undefined {
    const value = this.raw(name);
    return value === undefined ? fallback : this.#parse(name, schema, value);
  }

  #parse<T>(
    name: string,
    schema: z.ZodType<T, string>,
    value: string
  ): T | undefined {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    this.problems.push(
      `${name} ${parsed.error.issues[0]?.message ?? "is wrong"}`
    );
    return undefined;
  }
}

/** R2's S3 endpoint for a Cloudflare account. */
function r2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function readR2(
  read: EnvReader,
  keyId: string,
  secret: string
): S3BucketConfig | undefined {
  const accountId = read.required("R2_ACCOUNT_ID", schemas.accountId);
  const accessKeyId = read.required(keyId, schemas.text);
  const secretAccessKey = read.required(secret, schemas.text);
  if (!accountId || !accessKeyId || !secretAccessKey) return undefined;
  return {
    endpoint: r2Endpoint(accountId),
    region: "auto",
    accessKeyId,
    secretAccessKey,
  };
}

function readB2(
  read: EnvReader
): { b2: S3BucketConfig; bucket: string } | undefined {
  const endpoint = read.required("B2_S3_ENDPOINT", schemas.httpsUrl);
  const region = read.required("B2_REGION", schemas.text);
  const bucket = read.required("B2_BUCKET", schemas.bucket);
  const accessKeyId = read.required("B2_KEY_ID", schemas.text);
  const secretAccessKey = read.required("B2_APPLICATION_KEY", schemas.text);
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    return undefined;
  }
  return {
    bucket,
    b2: {
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      serverSideEncryption: "AES256",
    },
  };
}

/** What the nightly run needs, from the worker's environment. */
export function readOffsiteSettings(env: Env): OffsiteSettings {
  const read = new EnvReader(env);
  const appEnv = read.optional(
    "APP_ENV",
    z.enum(APP_ENVS, { error: `must be one of ${APP_ENVS.join(", ")}` }),
    "local"
  );
  if (appEnv !== undefined && appEnv !== "production") {
    return { kind: "not_production", appEnv };
  }

  const sourceBuckets = read.required(
    "OFFSITE_SOURCE_BUCKETS",
    schemas.bucketList
  );
  const days = read.optional(
    "OFFSITE_RETENTION_DAYS",
    schemas.days,
    DEFAULT_RETENTION_DAYS
  );
  const r2 = readR2(
    read,
    "OFFSITE_R2_ACCESS_KEY_ID",
    "OFFSITE_R2_SECRET_ACCESS_KEY"
  );
  const target = readB2(read);
  if (target && sourceBuckets?.includes(target.bucket)) {
    read.problems.push("B2_BUCKET must not be one of OFFSITE_SOURCE_BUCKETS");
  }
  if (
    read.problems.length > 0 ||
    !appEnv ||
    !sourceBuckets ||
    !days ||
    !r2 ||
    !target
  ) {
    return { kind: "invalid", problems: read.problems };
  }
  return {
    kind: "ready",
    config: {
      appEnv,
      sourceBuckets,
      targetBucket: target.bucket,
      retention: { days },
      budgetMs: RUN_BUDGET_MS,
      concurrency: COPY_CONCURRENCY,
    },
    r2,
    b2: target.b2,
  };
}

/** What `pnpm offsite:restore` needs: B2's copies and an R2 write key. */
export function readRestoreSettings(env: Env): RestoreSettings {
  const read = new EnvReader(env);
  const r2 = readR2(
    read,
    "OFFSITE_RESTORE_R2_ACCESS_KEY_ID",
    "OFFSITE_RESTORE_R2_SECRET_ACCESS_KEY"
  );
  const target = readB2(read);
  if (!r2 || !target) return { ok: false, problems: read.problems };
  return { ok: true, targetBucket: target.bucket, r2, b2: target.b2 };
}
