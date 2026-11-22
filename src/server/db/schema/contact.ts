// The contact inbox (#113). Each message from the public contact form is
// one `contact_message`, routed to a team (a staff role, #59) when it
// arrives and kept on that team even if the routing changes later. Staff
// assign it, move it through its statuses
// (src/server/modules/contact/domain/status.ts) and add notes, which are
// never edited (a trigger refuses updates).
//
// Personal data: the sender's name, address, organisation and words, the
// keyed hash of their IP network, and staff notes about them. Kept for 24
// months after a message closes (HR-31); see the data inventory.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  CONTACT_TEAMS,
  CONTACT_TOPICS,
} from "../../modules/contact/domain/routing";
import {
  CONTACT_CLOSE_REASONS,
  CONTACT_MESSAGE_STATUSES,
} from "../../modules/contact/domain/status";
import {
  CONTACT_FIELD_LIMITS,
  CONTACT_NOTE_MAX,
} from "../../modules/contact/domain/limits";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const contactTopic = pgEnum("contact_topic", CONTACT_TOPICS);

export const contactMessageStatus = pgEnum(
  "contact_message_status",
  CONTACT_MESSAGE_STATUSES
);

export const contactCloseReason = pgEnum(
  "contact_close_reason",
  CONTACT_CLOSE_REASONS
);

const TEAM_LIST = sql.raw(CONTACT_TEAMS.map((team) => `'${team}'`).join(", "));

const within = (column: unknown, max: number) =>
  sql`char_length(${column}) BETWEEN 1 AND ${sql.raw(String(max))}`;

export const contactMessage = pgTable(
  "contact_message",
  {
    /** UUIDv7. */
    id: uuid().primaryKey(),
    /** What the sender is told, such as `CM-27-8H3TZ0`. */
    reference: text().notNull(),
    topic: contactTopic().notNull(),
    /** The staff role it was routed to when it arrived. */
    team: text({ enum: CONTACT_TEAMS }).notNull(),
    name: text().notNull(),
    /** Trimmed and lower-cased. */
    email: text().notNull(),
    organisation: text(),
    subject: text().notNull(),
    message: text().notNull(),
    status: contactMessageStatus().notNull().default("new"),
    closeReason: contactCloseReason("close_reason"),
    assignedToUserId: uuid("assigned_to_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** A keyed hash of the sender's IP network, never the IP. */
    ipHash: text("ip_hash").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    closedAt: timestamptz("closed_at"),
    /** When the sender's acknowledgement went out; null until then. */
    acknowledgedAt: timestamptz("acknowledged_at"),
  },
  (table) => [
    unique("contact_message_reference_unique").on(table.reference),
    index("contact_message_team_status_created_at_idx").on(
      table.team,
      table.status,
      table.createdAt.desc()
    ),
    index("contact_message_assigned_to_user_id_idx").on(table.assignedToUserId),
    check("contact_message_team_known", sql`${table.team} IN (${TEAM_LIST})`),
    check(
      "contact_message_closed_with_reason",
      sql`(${table.status} = 'closed') = (${table.closeReason} IS NOT NULL AND ${table.closedAt} IS NOT NULL)`
    ),
    check(
      "contact_message_name_length",
      within(table.name, CONTACT_FIELD_LIMITS.name)
    ),
    check(
      "contact_message_email_length",
      within(table.email, CONTACT_FIELD_LIMITS.email)
    ),
    check(
      "contact_message_organisation_length",
      sql`${table.organisation} IS NULL OR ${within(table.organisation, CONTACT_FIELD_LIMITS.organisation)}`
    ),
    check(
      "contact_message_subject_length",
      within(table.subject, CONTACT_FIELD_LIMITS.subject)
    ),
    check(
      "contact_message_message_length",
      within(table.message, CONTACT_FIELD_LIMITS.message)
    ),
  ]
);

export type ContactMessage = typeof contactMessage.$inferSelect;

/** A note a member of staff left on a message. Never edited. */
export const contactNote = pgTable(
  "contact_note",
  {
    /** UUIDv7. */
    id: uuid().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => contactMessage.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    body: text().notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("contact_note_message_id_created_at_idx").on(
      table.messageId,
      table.createdAt
    ),
    check("contact_note_body_length", within(table.body, CONTACT_NOTE_MAX)),
  ]
);

export type ContactNote = typeof contactNote.$inferSelect;
