// Restores one file from its B2 copy into R2 (`pnpm offsite:restore`).
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import type { OffsiteConfig } from "./config";
import type { OffsiteDeps } from "./run-copy";

/** R2 (with a token that may write) and B2; no database needed. */
export type RestoreDeps = Pick<OffsiteDeps, "source" | "target"> & {
  config: Pick<OffsiteConfig, "targetBucket">;
};

export type RestoreResult =
  | { ok: true; bucket: string; key: string; sizeBytes: number }
  | { ok: false; reason: "not_in_backup" | "target_exists" | "etag_mismatch" };

export async function restoreOffsiteFile(
  _deps: RestoreDeps,
  _input: { bucket: string; key: string; to?: string; overwrite?: boolean }
): Promise<RestoreResult> {
  throw new Error("not implemented");
}
