// Events and campaigns (#125): what FOA runs for people to sign up to. One
// table for both kinds; a campaign differs only in needing no place. The
// status machine, the field rules and the slug live in
// src/server/modules/events/domain, which these enums are built from.
//
// The description is rich text stored as typed blocks (paragraphs and
// lists), never HTML, and passes through the one sanitiser on every save
// and every read (src/server/rich-text).
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type { LegalBlock } from "../../../content/legal/model";
import { EVENT_AUDIENCES } from "../../modules/events/domain/event-details";
import {
  EVENT_KINDS,
  EVENT_STATUSES,
} from "../../modules/events/domain/event-status";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const eventKind = pgEnum("event_kind", EVENT_KINDS);

export const eventStatus = pgEnum("event_status", EVENT_STATUSES);

export const eventAudience = pgEnum("event_audience", EVENT_AUDIENCES);

export const event = pgTable(
  "event",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    kind: eventKind().notNull(),
    /** The public URL segment, /events/<slug>. Set at creation, never changed. */
    slug: text().notNull().unique(),
    title: text().notNull(),
    summary: text().notNull(),
    /** Sanitised rich text: paragraphs and lists. */
    description: jsonb().$type<LegalBlock[]>().notNull(),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    /** Where it happens. A venue's address is the venue's, not a person's. */
    venueName: text("venue_name"),
    address: text(),
    city: text(),
    pinCode: text("pin_code"),
    /** An https link for an online event or campaign. */
    onlineUrl: text("online_url"),
    /** Places; null means unlimited. */
    capacity: integer(),
    audience: eventAudience().notNull(),
    /** null: registration opens when the event is published. */
    registrationOpensAt: timestamptz("registration_opens_at"),
    /** null: registration closes when the event starts. */
    registrationClosesAt: timestamptz("registration_closes_at"),
    waitlistEnabled: boolean("waitlist_enabled").notNull().default(false),
    status: eventStatus().notNull().default("draft"),
    /** The staff member who created it; kept when their account goes. */
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamptz("published_at"),
    cancelledAt: timestamptz("cancelled_at"),
    completedAt: timestamptz("completed_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check("event_ends_after_start", sql`${table.endsAt} > ${table.startsAt}`),
    check(
      "event_capacity_positive",
      sql`${table.capacity} IS NULL OR ${table.capacity} > 0`
    ),
    // With unlimited places nobody waits.
    check(
      "event_waitlist_needs_capacity",
      sql`${table.capacity} IS NOT NULL OR NOT ${table.waitlistEnabled}`
    ),
    // A published or completed event was published at some instant; a
    // cancelled one may have been, or may have been a draft.
    check(
      "event_published_at_when_published",
      sql`${table.status} NOT IN ('published', 'completed') OR ${table.publishedAt} IS NOT NULL`
    ),
    check(
      "event_cancelled_at_when_cancelled",
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} IS NOT NULL)`
    ),
    check(
      "event_completed_at_when_completed",
      sql`(${table.status} = 'completed') = (${table.completedAt} IS NOT NULL)`
    ),
    // The public list: published events by start.
    index("event_status_starts_at_idx").on(table.status, table.startsAt),
    index("event_created_by_user_id_idx").on(table.createdByUserId),
  ]
);

export type EventRow = typeof event.$inferSelect;
