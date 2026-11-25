import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { consentEvent } from "./consent";
import { fileAsset } from "./files";
import { galleryItem } from "./gallery";
import { encryptedText } from "../types/encrypted-text";

export const socialExportStatus = pgEnum("social_export_status", [
  "pending",
  "posted",
]);
const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const socialExport = pgTable("social_export", {
  id: uuid().primaryKey(),
  galleryItemId: uuid("gallery_item_id")
    .notNull()
    .unique()
    .references(() => galleryItem.id, { onDelete: "cascade" }),
  galleryConsentEventId: uuid("gallery_consent_event_id")
    .notNull()
    .references(() => consentEvent.id),
  socialConsentEventId: uuid("social_consent_event_id")
    .notNull()
    .references(() => consentEvent.id),
  fileId: uuid("file_id")
    .notNull()
    .references(() => fileAsset.id, { onDelete: "cascade" }),
  captionCiphertext: encryptedText("caption_ciphertext").notNull(),
  status: socialExportStatus().notNull(),
  createdAt: instant("created_at").notNull(),
  updatedAt: instant("updated_at").notNull(),
  postedAt: instant("posted_at"),
});
export type SocialExportRow = typeof socialExport.$inferSelect;
