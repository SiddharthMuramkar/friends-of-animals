// One night's off-site copy: every production R2 bucket's new and changed
// objects to B2, then the retention rule for objects gone from R2.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";
import type { CopyBucket } from "../../ports/copy-bucket";
import type { ErrorReporter } from "../../ports/errors";
import type { OffsiteConfig } from "./config";
import { contentMd5ForEtag } from "./domain/etag";
import { offsiteKeyFor } from "./domain/keys";
import { decideRunOutcome } from "./domain/outcome";
import { planOffsiteCopy, type SourceObject } from "./domain/plan";
import { OffsiteCopyIncompleteError } from "./errors";
import {
  clearDeletedInSource,
  forgetCopy,
  manifestOf,
  markDeletedInSource,
  recordCopy,
} from "./manifest";

/** The B2 metadata key holding the etag the object had in R2. */
export const SOURCE_ETAG_METADATA = "foa-source-etag";

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

function emptyTotals(): OffsiteTotals {
  return {
    copied: 0,
    unchanged: 0,
    deferred: 0,
    failed: 0,
    markedDeleted: 0,
    clearedDeleted: 0,
    purged: 0,
    held: 0,
    skippedNonProduction: 0,
  };
}

export async function runOffsiteCopy(
  deps: OffsiteDeps,
  input: { finalAttempt: boolean }
): Promise<OffsiteRunReport> {
  if (deps.config.appEnv !== "production") {
    return { status: "skipped", reason: "not_production" };
  }
  const totals = emptyTotals();
  const failedBuckets: string[] = [];
  for (const bucket of deps.config.sourceBuckets) {
    const refused = await copyBucket(deps, bucket, totals);
    if (refused) failedBuckets.push(bucket);
  }
  const outcome = decideRunOutcome(
    {
      failedObjects: totals.failed,
      failedBuckets: failedBuckets.length,
      massDeletionBuckets: 0,
    },
    input
  );
  const report = { status: outcome.status, failedBuckets, ...totals };
  if (report.status === "incomplete") {
    throw new OffsiteCopyIncompleteError(report);
  }
  return report;
}

/** Copies one bucket; true if its listing was refused. */
async function copyBucket(
  deps: OffsiteDeps,
  bucket: string,
  totals: OffsiteTotals
): Promise<boolean> {
  const source: SourceObject[] = [];
  for await (const object of deps.source.list({ bucket })) source.push(object);
  const plan = planOffsiteCopy({
    source,
    manifest: await manifestOf(deps.db, bucket),
    now: deps.clock.now(),
    retention: deps.config.retention,
  });
  totals.unchanged += plan.unchanged;
  totals.skippedNonProduction += plan.skippedNonProduction;
  if (plan.refused !== null) return true;

  await eachAtMost(deps.config.concurrency, plan.copy, async ({ object }) => {
    if (await copyObject(deps, bucket, object)) totals.copied += 1;
  });

  await clearDeletedInSource(deps.db, bucket, plan.clearDeleted);
  totals.clearedDeleted += plan.clearDeleted.length;
  await markDeletedInSource(
    deps.db,
    bucket,
    plan.markDeleted,
    deps.clock.now()
  );
  totals.markedDeleted += plan.markDeleted.length;
  totals.held += plan.held;
  for (const key of plan.purge) {
    await deps.target.delete({
      bucket: deps.config.targetBucket,
      key: offsiteKeyFor({ bucket, key }),
    });
    await forgetCopy(deps.db, { sourceBucket: bucket, key });
    totals.purged += 1;
  }
  return false;
}

/**
 * Streams one object from R2 to B2 and records it. False if it left R2
 * since the listing: the next run sees it gone.
 */
async function copyObject(
  deps: OffsiteDeps,
  bucket: string,
  object: SourceObject
): Promise<boolean> {
  const read = await deps.source.read({ bucket, key: object.key });
  if (read === null) return false;
  await deps.target.write({
    bucket: deps.config.targetBucket,
    key: offsiteKeyFor({ bucket, key: object.key }),
    body: read.body,
    sizeBytes: read.sizeBytes,
    contentType: read.contentType,
    contentMd5: contentMd5ForEtag(read.etag),
    metadata: { ...read.metadata, [SOURCE_ETAG_METADATA]: read.etag },
  });
  // What was read is what B2 holds, even if R2 changed after the listing.
  await recordCopy(deps.db, {
    sourceBucket: bucket,
    key: object.key,
    etag: read.etag,
    sizeBytes: read.sizeBytes,
    sourceLastModified: object.lastModified,
    copiedAt: deps.clock.now(),
  });
  return true;
}

/** Runs `work` over `items`, at most `limit` at a time. */
async function eachAtMost<T>(
  limit: number,
  items: readonly T[],
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await work(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
}
