// The offsite_copy rows: what B2 holds a copy of, per source bucket.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { offsiteCopy } from "../../db/schema/offsite-copy";
import type { ManifestEntry } from "./domain/plan";

/** Every copy of `bucket`'s objects that B2 holds. */
export async function manifestOf(
  db: AppDb,
  bucket: string
): Promise<ManifestEntry[]> {
  return db
    .select({
      key: offsiteCopy.key,
      etag: offsiteCopy.etag,
      sizeBytes: offsiteCopy.sizeBytes,
      deletedInSourceAt: offsiteCopy.deletedInSourceAt,
    })
    .from(offsiteCopy)
    .where(eq(offsiteCopy.sourceBucket, bucket));
}

/** Records a finished copy; an object back in R2 loses its deletion mark. */
export async function recordCopy(
  db: AppDb,
  copy: {
    sourceBucket: string;
    key: string;
    etag: string;
    sizeBytes: number;
    sourceLastModified: Date;
    copiedAt: Date;
  }
): Promise<void> {
  const row = { ...copy, deletedInSourceAt: null };
  await db
    .insert(offsiteCopy)
    .values(row)
    .onConflictDoUpdate({
      target: [offsiteCopy.sourceBucket, offsiteCopy.key],
      set: row,
    });
}
