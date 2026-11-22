// Uploaded files (#63). One row per object in a private bucket: who
// uploaded it, what for, what was declared, where it is and how far it has
// got (src/server/modules/files/domain/file-status.ts). The uploader's own
// filename is never stored.
//
// Loads under plain Node (drizzle-kit, the worker): relative imports only,
// no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { FILE_STATUSES } from "../../modules/files/domain/file-status";
import { FILE_PURPOSES } from "../../modules/files/domain/purposes";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** A module that takes uploads adds its purpose in a migration of its own. */
export const fileAssetPurpose = pgEnum("file_asset_purpose", FILE_PURPOSES);

export const fileAssetStatus = pgEnum("file_asset_status", FILE_STATUSES);

export const fileAsset = pgTable(
  "file_asset",
  {
    /** UUIDv7; also the last part of the storage key. */
    id: uuid().primaryKey(),
    /**
     * The uploader. Restricted: deleting an account must delete its objects
     * and these rows first, or the objects would be left behind.
     */
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    purpose: fileAssetPurpose().notNull(),
    /** As declared at presign, normalised; the object must match it. */
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    bucket: text().notNull(),
    /** `<prefix><purpose>/<id>`, or under quarantine/ once flagged. */
    storageKey: text("storage_key").notNull().unique(),
    status: fileAssetStatus().notNull().default("pending_upload"),
    /** Hex SHA-256 of the bytes, recorded by the scan. */
    sha256: text(),
    /** What the scanner said: "OK", or the signature it found. */
    scanResult: text("scan_result"),
    scannedAt: timestamptz("scanned_at"),
    /** When the stored object was confirmed to match its declaration. */
    uploadedAt: timestamptz("uploaded_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check("file_asset_size_bytes_positive", sql`${table.sizeBytes} > 0`),
    index("file_asset_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt.desc()
    ),
  ]
);

export type FileAssetRow = typeof fileAsset.$inferSelect;
