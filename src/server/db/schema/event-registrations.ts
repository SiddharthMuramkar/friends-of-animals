// Event registrations (#125): who holds a place at an event, who is
// waiting for one, and who withdrew. Cancelling keeps the row, and
// registering again adds a new one, so the history stays. Every status
// change goes through the move table in
// src/server/modules/events/domain/registration-status.ts, and every write
// that touches places runs in the transaction that locked the event's row
// (src/server/modules/events/places.ts); the constraints below are the
// backstop.
//
// The attendee is an adult's account (attendee_user_id) or a child's
// participant profile (attendee_profile_id), never both: a guardian
// registers a child, and registered_by_user_id says who did.
//
// Two foreign keys come once their tables are on this branch, with the
// migration regenerated then: event_id to the event table (125a) and
// attendee_profile_id to the participant profile table (#81).
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { REGISTRATION_STATUSES } from "../../modules/events/domain/registration-status";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Every status exists from the start, check-in's included (125c). */
export const eventRegistrationStatus = pgEnum(
  "event_registration_status",
  REGISTRATION_STATUSES
);

export const eventRegistration = pgTable(
  "event_registration",
  {
    /** UUIDv7. */
    id: uuid().primaryKey(),
    eventId: uuid("event_id").notNull(),
    /** An adult registering themselves. */
    attendeeUserId: uuid("attendee_user_id").references(() => user.id),
    /** A child, registered by a guardian. */
    attendeeProfileId: uuid("attendee_profile_id"),
    /** The attendee themselves, or the guardian who registered a child. */
    registeredByUserId: uuid("registered_by_user_id")
      .notNull()
      .references(() => user.id),
    status: eventRegistrationStatus().notNull(),
    /** When they joined the waitlist: their place in line. */
    waitlistedAt: timestamptz("waitlisted_at"),
    /** When a freed or added place went to them. */
    promotedAt: timestamptz("promoted_at"),
    cancelledAt: timestamptz("cancelled_at"),
    /** The attendee, a guardian or staff. */
    cancelledByUserId: uuid("cancelled_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    checkedInAt: timestamptz("checked_in_at"),
    checkedInByUserId: uuid("checked_in_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // One active registration per person per event; after a cancellation
    // they may register again. 'cancelled' comes from the same CREATE TYPE
    // as the table's enum, so the predicates may use it.
    uniqueIndex("event_registration_active_user_key")
      .on(table.eventId, table.attendeeUserId)
      .where(
        sql`${table.attendeeUserId} IS NOT NULL AND ${table.status} <> 'cancelled'`
      ),
    uniqueIndex("event_registration_active_profile_key")
      .on(table.eventId, table.attendeeProfileId)
      .where(
        sql`${table.attendeeProfileId} IS NOT NULL AND ${table.status} <> 'cancelled'`
      ),
    // Counting places and reading the waitlist in order.
    index("event_registration_event_status_idx").on(
      table.eventId,
      table.status,
      table.waitlistedAt,
      table.id
    ),
    index("event_registration_attendee_user_id_idx").on(table.attendeeUserId),
    index("event_registration_attendee_profile_id_idx").on(
      table.attendeeProfileId
    ),
    index("event_registration_registered_by_user_id_idx").on(
      table.registeredByUserId
    ),
    index("event_registration_cancelled_by_user_id_idx").on(
      table.cancelledByUserId
    ),
    index("event_registration_checked_in_by_user_id_idx").on(
      table.checkedInByUserId
    ),
    check(
      "event_registration_one_attendee",
      sql`(${table.attendeeUserId} IS NULL) <> (${table.attendeeProfileId} IS NULL)`
    ),
    check(
      "event_registration_waitlisted_at_when_waiting",
      sql`${table.status} <> 'waitlisted' OR ${table.waitlistedAt} IS NOT NULL`
    ),
    check(
      "event_registration_promoted_from_waitlist",
      sql`${table.promotedAt} IS NULL OR ${table.waitlistedAt} IS NOT NULL`
    ),
    check(
      "event_registration_cancelled_at_when_cancelled",
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} IS NOT NULL)`
    ),
    check(
      "event_registration_checked_in_at_when_checked_in",
      sql`(${table.status} = 'checked_in') = (${table.checkedInAt} IS NOT NULL)`
    ),
  ]
);

export type EventRegistration = typeof eventRegistration.$inferSelect;
