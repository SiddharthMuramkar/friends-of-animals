import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { entry } from "./entries";
import { consentEvent } from "./consent";
import { fileAsset } from "./files";
import { user } from "./identity";
import { encryptedText } from "../types/encrypted-text";

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const galleryItemStatus = pgEnum("gallery_item_status", [
  "draft",
  "published",
  "hidden",
  "unpublished",
]);
export const galleryItem = pgTable(
  "gallery_item",
  {
    id: uuid().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .unique()
      .references(() => entry.id, { onDelete: "cascade" }),
    consentEventId: uuid("consent_event_id")
      .notNull()
      .references(() => consentEvent.id),
    fileId: uuid("file_id")
      .notNull()
      .references(() => fileAsset.id, { onDelete: "cascade" }),
    status: galleryItemStatus().notNull(),
    title: text().notNull(),
    story: text().notNull(),
    reviewed: boolean().notNull().default(false),
    featured: boolean().notNull().default(false),
    publishedAt: instant("published_at"),
    reason: text(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [index("gallery_item_status_created_idx").on(t.status, t.createdAt)]
);
export type GalleryItemRow = typeof galleryItem.$inferSelect;

export const galleryPurgeStatus = pgEnum("gallery_purge_status", [
  "pending",
  "completed",
  "failed",
]);
/** The public routes only, never a storage key or participant credit. Kept
 * independently of an item so erasure cannot cancel a pending purge. */
export const galleryPurge = pgTable("gallery_purge", {
  id: uuid().primaryKey(),
  itemId: uuid("item_id").notNull(),
  status: galleryPurgeStatus().notNull(),
  requestedAt: instant("requested_at").notNull(),
  deadlineAt: instant("deadline_at").notNull(),
  completedAt: instant("completed_at"),
  attempts: integer().notNull().default(0),
  overdueAlerted: boolean("overdue_alerted").notNull().default(false),
});

export const galleryReportStatus = pgEnum("gallery_report_status", [
  "open",
  "actioned",
  "dismissed",
]);
export const galleryReportReason = pgEnum("gallery_report_reason", [
  "identifies_child",
  "inappropriate_content",
  "wrong_credit",
  "other",
]);
export const galleryReport = pgTable(
  "gallery_report",
  {
    id: uuid().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => galleryItem.id, { onDelete: "cascade" }),
    reason: galleryReportReason().notNull(),
    detailsCiphertext: encryptedText("details_ciphertext"),
    contactCiphertext: encryptedText("contact_ciphertext"),
    status: galleryReportStatus().notNull(),
    createdAt: instant("created_at").notNull(),
    handledAt: instant("handled_at"),
    handledByUserId: uuid("handled_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("gallery_report_status_created_idx").on(t.status, t.createdAt)]
);
