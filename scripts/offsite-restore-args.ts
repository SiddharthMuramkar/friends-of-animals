// The arguments of `pnpm offsite:restore`, kept apart from the script so
// they can be tested without buckets.

export const OFFSITE_RESTORE_USAGE =
  "Usage: pnpm offsite:restore --bucket <r2 bucket> --key <key> [--to <r2 bucket>] [--overwrite]";

export type OffsiteRestoreArgs =
  | { ok: true; bucket: string; key: string; to: string; overwrite: boolean }
  | { ok: false; error: string };

export function parseOffsiteRestoreArgs(
  _argv: readonly string[]
): OffsiteRestoreArgs {
  return { ok: false, error: "not implemented" };
}
