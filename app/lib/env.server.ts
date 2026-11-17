import { z } from "zod";

const DEV_SESSION_SECRET = "dev-only-insecure-session-secret-change-me!!";

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    SESSION_SECRET: z.string().optional(),
    STORAGE_DRIVER: z.enum(["local", "blob"]).default("local"),
    UPLOAD_DIR: z.string().min(1).default("./data/uploads"),
    BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV === "production") {
      if (!val.SESSION_SECRET || val.SESSION_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SESSION_SECRET"],
          message: "SESSION_SECRET must be at least 32 characters in production",
        });
      }
    }
    if (val.STORAGE_DRIVER === "blob" && !val.BLOB_READ_WRITE_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BLOB_READ_WRITE_TOKEN"],
        message: "BLOB_READ_WRITE_TOKEN is required when STORAGE_DRIVER=blob",
      });
    }
  })
  .transform((val) => {
    let SESSION_SECRET = val.SESSION_SECRET;
    if (!SESSION_SECRET) {
      console.warn(
        "[env] SESSION_SECRET is not set; using an insecure development default. Set SESSION_SECRET before deploying.",
      );
      SESSION_SECRET = DEV_SESSION_SECRET;
    }
    return { ...val, SESSION_SECRET };
  });

export type Env = z.output<typeof envSchema>;

/** Parse an env-like object. Throws a readable error on invalid config. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so `FOO=` in .env behaves like missing.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Lazily parsed, cached server config. Importing this module never throws;
 * the first call to `env()` validates process.env.
 */
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Test helper: clear the cached config so the next `env()` re-reads process.env. */
export function resetEnvCache() {
  cached = undefined;
}
