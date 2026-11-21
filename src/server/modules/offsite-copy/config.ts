// What the off-site copy runs with.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

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

export function readOffsiteSettings(
  _env: Record<string, string | undefined>
): unknown {
  throw new Error("not implemented");
}

export function readRestoreSettings(
  _env: Record<string, string | undefined>
): unknown {
  throw new Error("not implemented");
}
