// Restores one file from its B2 copy into R2 (`pnpm offsite:restore`, see
// docker/README.md). It needs no database: B2's copy alone says what the
// object was, so a restore works even after the manifest is lost.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import { ContentDigestMismatchError } from "../../ports/copy-bucket";
import type { OffsiteConfig } from "./config";
import { contentMd5ForEtag } from "./domain/etag";
import { offsiteKeyFor } from "./domain/keys";
import { SOURCE_ETAG_METADATA, type OffsiteDeps } from "./run-copy";

/** R2 (with a token that may write) and B2; no database needed. */
export type RestoreDeps = Pick<OffsiteDeps, "source" | "target"> & {
  config: Pick<OffsiteConfig, "targetBucket">;
};

export type RestoreResult =
  | { ok: true; bucket: string; key: string; sizeBytes: number }
  | { ok: false; reason: "not_in_backup" | "target_exists" | "etag_mismatch" };

/**
 * Copies the B2 copy of `bucket`/`key` to `key` in `to` (default: `bucket`).
 * An existing object there is replaced only with `overwrite`. The bytes go
 * with the Content-MD5 of the etag R2 had, so R2 refuses a damaged copy;
 * a multipart upload's etag has no such check.
 */
export async function restoreOffsiteFile(
  deps: RestoreDeps,
  input: { bucket: string; key: string; to?: string; overwrite?: boolean }
): Promise<RestoreResult> {
  const { key } = input;
  const to = input.to ?? input.bucket;
  const copy = await deps.target.read({
    bucket: deps.config.targetBucket,
    key: offsiteKeyFor({ bucket: input.bucket, key }),
  });
  if (copy === null) return { ok: false, reason: "not_in_backup" };

  const { [SOURCE_ETAG_METADATA]: sourceEtag, ...metadata } = copy.metadata;
  if (!input.overwrite && (await deps.source.exists({ bucket: to, key }))) {
    await copy.body.cancel();
    return { ok: false, reason: "target_exists" };
  }
  try {
    await deps.source.write({
      bucket: to,
      key,
      body: copy.body,
      sizeBytes: copy.sizeBytes,
      contentType: copy.contentType,
      contentMd5:
        sourceEtag === undefined ? null : contentMd5ForEtag(sourceEtag),
      metadata,
    });
  } catch (error) {
    if (error instanceof ContentDigestMismatchError) {
      return { ok: false, reason: "etag_mismatch" };
    }
    throw error;
  }
  return { ok: true, bucket: to, key, sizeBytes: copy.sizeBytes };
}
