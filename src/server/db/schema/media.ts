// Derived copies of uploaded files (#85): a thumbnail and a display copy of
// each clean image, made by worker-media. A derivative is read under its
// parent file's rules (src/server/modules/files/use-cases/derivative-url.ts);
// it has no owner or status of its own.
//
// `file_processing` says how far a file's media job has got, apart from
// file_asset.status, so #63's status enum never grows processing values.
//
// Retention (HR-31): derivatives are proposed to follow their original.
// The foreign keys restrict, so whatever deletes a file must delete its
// derivatives' objects and rows first, or the objects would be left behind.
//
// Loads under plain Node (drizzle-kit, the worker): relative imports only,
// no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { fileAsset } from "./files";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const fileProcessingStatus = pgEnum("file_processing_status", [
  /** Waiting for worker-media, or being processed. */
  "queued",
  /** Every derivative is stored. */
  "done",
  /** It can't be processed: error_code says why. */
  "failed",
]);

/** One row per file that has media work; none for a file that has none. */
export const fileProcessing = pgTable(
  "file_processing",
  {
    fileAssetId: uuid("file_asset_id")
      .primaryKey()
      .references(() => fileAsset.id, { onDelete: "restrict" }),
    status: fileProcessingStatus().notNull().default("queued"),
    /** A MediaErrorCode (src/server/ports/media.ts), or processing_error. */
    errorCode: text("error_code"),
    /** Times worker-media started on it. */
    attempts: integer().notNull().default(0),
    queuedAt: timestamptz("queued_at").notNull(),
    /** When it became done or failed. */
    finishedAt: timestamptz("finished_at"),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check("file_processing_attempts_not_negative", sql`${table.attempts} >= 0`),
    check(
      "file_processing_error_code_when_failed",
      sql`(${table.status} = 'failed') = (${table.errorCode} IS NOT NULL)`
    ),
    check(
      "file_processing_finished_at_when_finished",
      sql`(${table.status} = 'queued') = (${table.finishedAt} IS NULL)`
    ),
  ]
);

/** One derived copy of a file, of one kind. */
export const fileDerivative = pgTable(
  "file_derivative",
  {
    /** UUIDv7. */
    id: uuid().primaryKey(),
    fileAssetId: uuid("file_asset_id")
      .notNull()
      .references(() => fileAsset.id, { onDelete: "restrict" }),
    /**
     * A key of DERIVATIVE_KINDS (src/server/modules/files/domain/
     * derivatives.ts). Text, not an enum: later tickets add kinds (a video
     * poster, a clean PDF, stamped copies) without a migration.
     */
    kind: text().notNull(),
    bucket: text().notNull(),
    /** `<prefix>derived/<file id>/<kind>.webp`. */
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    /** Pixels; null for a kind with no picture size. */
    width: integer(),
    height: integer(),
    /** For a video kind; null for images. */
    durationMs: integer("duration_ms"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    unique("file_derivative_file_asset_id_kind_key").on(
      table.fileAssetId,
      table.kind
    ),
    check("file_derivative_size_bytes_positive", sql`${table.sizeBytes} > 0`),
    check(
      "file_derivative_size_positive",
      sql`(${table.width} IS NULL OR ${table.width} > 0) AND (${table.height} IS NULL OR ${table.height} > 0)`
    ),
  ]
);

export type FileProcessingRow = typeof fileProcessing.$inferSelect;
export type FileDerivativeRow = typeof fileDerivative.$inferSelect;
