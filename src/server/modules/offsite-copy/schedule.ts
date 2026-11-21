// The nightly schedule that runs the off-site copy in the worker.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import type { CopyBucket } from "../../ports/copy-bucket";
import type { S3BucketConfig } from "../../ports/copy-bucket-s3";

export async function runScheduledOffsiteCopy(
  _deps: unknown,
  _job: { finalAttempt: boolean } | undefined,
  _options: {
    env: Record<string, string | undefined>;
    connect?: (settings: { r2: S3BucketConfig; b2: S3BucketConfig }) => {
      source: CopyBucket;
      target: CopyBucket;
    };
  }
): Promise<void> {
  throw new Error("not implemented");
}
