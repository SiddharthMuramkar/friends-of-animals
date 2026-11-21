// One night's off-site copy: every production R2 bucket's new and changed
// objects to B2, then the retention rule for objects gone from R2.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";
import type { CopyBucket } from "../../ports/copy-bucket";
import type { ErrorReporter } from "../../ports/errors";
import type { OffsiteConfig } from "./config";

export type OffsiteDeps = {
  db: AppDb;
  clock: Clock;
  errors: ErrorReporter;
  /** R2: the production buckets, read-only. */
  source: CopyBucket;
  /** B2: the bucket the copies live in. */
  target: CopyBucket;
  config: OffsiteConfig;
};

/** What one run did, summed over every source bucket. */
export type OffsiteTotals = {
  /** New or changed objects now copied to B2. */
  copied: number;
  /** Objects B2 already held as they are. */
  unchanged: number;
  /** Copies not started because the run was out of time. */
  deferred: number;
  /** Copies, marks or purges that failed. */
  failed: number;
  /** Objects found gone from R2 this run; their copies are kept. */
  markedDeleted: number;
  /** Objects back in R2 unchanged before their copy was purged. */
  clearedDeleted: number;
  /** Copies deleted from B2 once the retention window had passed. */
  purged: number;
  /** Copies of objects gone from R2, still inside the window. */
  held: number;
  /** Keys under a staging, local or preview prefix: never copied. */
  skippedNonProduction: number;
};

export type OffsiteRunReport =
  | { status: "skipped"; reason: "not_production" }
  | ({
      status: "complete" | "incomplete";
      /** Buckets whose listing failed or was refused. */
      failedBuckets: string[];
    } & OffsiteTotals);

export async function runOffsiteCopy(
  _deps: OffsiteDeps,
  _input: { finalAttempt: boolean }
): Promise<OffsiteRunReport> {
  throw new Error("not implemented");
}
