// The offsite_copy rows: what B2 holds a copy of, per source bucket.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

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

/** Keeps each statement's parameter list well inside Postgres's limit. */
const KEYS_PER_STATEMENT = 1000;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += KEYS_PER_STATEMENT) {
    out.push(items.slice(i, i + KEYS_PER_STATEMENT));
  }
  return out;
}

/** Marks copies whose objects a run found gone from R2, as of `at`. */
export async function markDeletedInSource(
  db: AppDb,
  sourceBucket: string,
  keys: readonly string[],
  at: Date
): Promise<void> {
  for (const chunk of chunks(keys)) {
    await db
      .update(offsiteCopy)
      .set({ deletedInSourceAt: at })
      .where(
        and(
          eq(offsiteCopy.sourceBucket, sourceBucket),
          inArray(offsiteCopy.key, chunk),
          isNull(offsiteCopy.deletedInSourceAt)
        )
      );
  }
}

/** Unmarks copies whose objects are back in R2 unchanged. */
export async function clearDeletedInSource(
  db: AppDb,
  sourceBucket: string,
  keys: readonly string[]
): Promise<void> {
  for (const chunk of chunks(keys)) {
    await db
      .update(offsiteCopy)
      .set({ deletedInSourceAt: null })
      .where(
        and(
          eq(offsiteCopy.sourceBucket, sourceBucket),
          inArray(offsiteCopy.key, chunk),
          isNotNull(offsiteCopy.deletedInSourceAt)
        )
      );
  }
}

/** Forgets a copy once B2 no longer holds it. */
export async function forgetCopy(
  db: AppDb,
  { sourceBucket, key }: { sourceBucket: string; key: string }
): Promise<void> {
  await db
    .delete(offsiteCopy)
    .where(
      and(eq(offsiteCopy.sourceBucket, sourceBucket), eq(offsiteCopy.key, key))
    );
}
