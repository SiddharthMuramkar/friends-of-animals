// The arguments of `pnpm offsite:restore`, kept apart from the script so
// they can be tested without buckets.

import { parseArgs } from "node:util";

import { BUCKET_NAME } from "../src/server/modules/offsite-copy/domain/keys";

export const OFFSITE_RESTORE_USAGE =
  "Usage: pnpm offsite:restore --bucket <r2 bucket> --key <key> " +
  "[--to <r2 bucket>] [--overwrite]";

export type OffsiteRestoreArgs =
  | { ok: true; bucket: string; key: string; to: string; overwrite: boolean }
  | { ok: false; error: string };

const refuse = (reason: string): OffsiteRestoreArgs => ({
  ok: false,
  error: `${reason}\n${OFFSITE_RESTORE_USAGE}`,
});

export function parseOffsiteRestoreArgs(
  argv: readonly string[]
): OffsiteRestoreArgs {
  // `pnpm <script> -- --bucket x` passes the separator on.
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let values: {
    bucket?: string;
    key?: string;
    to?: string;
    overwrite?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        bucket: { type: "string" },
        key: { type: "string" },
        to: { type: "string" },
        overwrite: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }
  const { bucket, key, to = bucket, overwrite = false } = values;
  if (bucket === undefined || !BUCKET_NAME.test(bucket)) {
    return refuse("Give the R2 bucket the file was in with --bucket.");
  }
  if (key === undefined || key === "") {
    return refuse("Give the file's key in that bucket with --key.");
  }
  if (to === undefined || !BUCKET_NAME.test(to)) {
    return refuse("--to must be an R2 bucket name.");
  }
  return { ok: true, bucket, key, to, overwrite };
}
