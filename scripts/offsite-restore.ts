// Restores one file from the off-site copy in Backblaze B2 into R2:
//
//   pnpm offsite:restore --bucket <r2 bucket> --key <key> [--to <r2 bucket>] [--overwrite]
//
// Run it in the worker-prod container (docker/README.md, "Off-site copy of
// files"). It reads B2's settings like the nightly copy, plus an R2 key that
// may write (OFFSITE_RESTORE_R2_*), which the operator passes for this run
// only. It needs no database: B2's copy says what the object was.
//
// Exit codes: 0 restored; 1 refused or failed (the message says why);
// 2 bad arguments.

import { readRestoreSettings } from "../src/server/modules/offsite-copy/config";
import {
  restoreOffsiteFile,
  type RestoreResult,
} from "../src/server/modules/offsite-copy/restore";
import { s3CopyBucket } from "../src/server/ports/copy-bucket-s3";
import { loadEnvFiles } from "./load-env";
import { parseOffsiteRestoreArgs } from "./offsite-restore-args";

const args = parseOffsiteRestoreArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(args.error);
  process.exit(2);
}

loadEnvFiles();

const settings = readRestoreSettings(process.env);
if (!settings.ok) {
  console.error(
    `Can't restore: ${settings.problems.join("; ")}. See docker/README.md.`
  );
  process.exit(1);
}

const REFUSALS: Record<Exclude<RestoreResult, { ok: true }>["reason"], string> =
  {
    not_in_backup: `B2 holds no copy of ${args.bucket}/${args.key}. Check the bucket and key.`,
    target_exists: `${args.to}/${args.key} already exists. Pass --overwrite to replace it, or --to another bucket.`,
    etag_mismatch: `The B2 copy of ${args.bucket}/${args.key} doesn't match the etag it was copied with; nothing was written.`,
  };

try {
  const result = await restoreOffsiteFile(
    {
      source: s3CopyBucket(settings.r2),
      target: s3CopyBucket(settings.b2),
      config: { targetBucket: settings.targetBucket },
    },
    args
  );
  if (!result.ok) {
    console.error(REFUSALS[result.reason]);
    process.exit(1);
  }
  console.log(
    `Restored ${result.bucket}/${result.key} (${result.sizeBytes} bytes) from B2.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
