// The off-site copy's manifest (#68). One row per production object that
// Backblaze B2 holds a copy of, keyed by the R2 bucket and key it came
// from: what was copied (etag and size) and, once the object has left R2,
// since when, so its copy is purged only after the retention window.
// Losing these rows is safe: the next run copies everything again and never
// purges a copy it has no row for.
//
// Loads under plain Node (drizzle-kit, the worker): relative imports only,
// no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const offsiteCopy = pgTable(
  "offsite_copy",
  {
    /** The R2 bucket the object is in; its copy is `<bucket>/<key>` in B2. */
    sourceBucket: text("source_bucket").notNull(),
    key: text().notNull(),
    /** The copied object's etag, normalised (no quotes, lower case). */
    etag: text().notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sourceLastModified: timestamptz("source_last_modified").notNull(),
    copiedAt: timestamptz("copied_at").notNull(),
    /** When a run first found the object gone from R2; null while there. */
    deletedInSourceAt: timestamptz("deleted_in_source_at"),
  },
  (table) => [
    primaryKey({ columns: [table.sourceBucket, table.key] }),
    check("offsite_copy_size_bytes_not_negative", sql`${table.sizeBytes} >= 0`),
    index("offsite_copy_deleted_in_source_idx")
      .on(table.sourceBucket, table.deletedInSourceAt)
      .where(sql`${table.deletedInSourceAt} IS NOT NULL`),
  ]
);

export type OffsiteCopyRow = typeof offsiteCopy.$inferSelect;
