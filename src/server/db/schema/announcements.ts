// Announcements (#84): what a competition manager tells a competition's
// confirmed registrants, as structured plain-text sections (never HTML),
// a draft until it is sent. Sending stamps who sent it, when, and how many
// people it was planned for; the fan-out goes through the notifications
// module, so who received it is in `message_delivery`, not here.
//
// The data inventory covers the encrypted help contacts and staff accounts.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { ANNOUNCEMENT_STATUSES } from "../../modules/announcements/domain/status";
import { encryptedText } from "../types/encrypted-text";
import { competition } from "./competitions";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const announcementStatusEnum = pgEnum(
  "announcement_status",
  ANNOUNCEMENT_STATUSES
);

export const HELP_CONTACTS_PURPOSE = "announcement.help_contacts";

export const announcement = pgTable(
  "announcement",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    status: announcementStatusEnum().notNull().default("draft"),
    revision: integer().notNull().default(1),
    subject: text().notNull(),
    /** When the event starts; the composer takes it in IST. */
    eventAt: timestamptz("event_at"),
    confirmedTheme: text("confirmed_theme"),
    permittedMaterials: text("permitted_materials"),
    duration: text(),
    submissionSteps: text("submission_steps"),
    physicalArtworkRequirements: text("physical_artwork_requirements"),
    deadlines: text(),
    helpContactsCiphertext: encryptedText("help_contacts_ciphertext"),
    /** A closing message, after the sections. */
    message: text(),
    /** Null for seed data, or once the account is gone. */
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    sentBy: uuid("sent_by").references(() => user.id, {
      onDelete: "set null",
    }),
    sentAt: timestamptz("sent_at"),
    /** How many people the send planned to reach. */
    recipientCount: integer("recipient_count"),
  },
  (table) => [
    // A sent announcement says when and to how many; a draft says neither.
    check(
      "announcement_sent_stamped",
      sql`(${table.status} = 'sent') = (${table.sentAt} IS NOT NULL) AND (${table.sentAt} IS NULL) = (${table.recipientCount} IS NULL)`
    ),
    check(
      "announcement_recipient_count_not_negative",
      sql`${table.recipientCount} >= 0`
    ),
    // A competition's announcements, newest first.
    index("announcement_competition_newest_idx").on(
      table.competitionId,
      table.createdAt.desc(),
      table.id.desc()
    ),
    // Deleting a user sets these to null; the indexes keep that from scanning.
    index("announcement_created_by_idx").on(table.createdBy),
    index("announcement_sent_by_idx").on(table.sentBy),
  ]
);

export type AnnouncementRow = typeof announcement.$inferSelect;
