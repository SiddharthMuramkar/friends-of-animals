// An event campaign is an occasion people attend, unrelated to outbound
// message campaigns. All lifecycle values are defined before first use.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  EVENT_KINDS,
  EVENT_STATUSES,
} from "../../modules/events/domain/event-status";
import { EVENT_AUDIENCES } from "../../modules/events/domain/event-details";
import { REGISTRATION_STATUSES } from "../../modules/events/domain/registration-status";
import { user } from "./identity";
import { participantProfile } from "./registration";

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const eventKind = pgEnum("event_kind", EVENT_KINDS);
export const eventStatus = pgEnum("event_status", EVENT_STATUSES);
export const eventAudience = pgEnum("event_audience", EVENT_AUDIENCES);
export const eventRegistrationStatus = pgEnum(
  "event_registration_status",
  REGISTRATION_STATUSES
);

export const event = pgTable(
  "event",
  {
    id: uuid().primaryKey(),
    slug: text().notNull().unique(),
    kind: eventKind().notNull(),
    status: eventStatus().notNull(),
    title: text().notNull(),
    summary: text().notNull(),
    description: text().notNull(),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at").notNull(),
    venueName: text("venue_name"),
    address: text(),
    city: text(),
    pinCode: text("pin_code"),
    onlineUrl: text("online_url"),
    capacity: integer(),
    audience: eventAudience().notNull(),
    registrationOpensAt: instant("registration_opens_at"),
    registrationClosesAt: instant("registration_closes_at"),
    waitlistEnabled: boolean("waitlist_enabled").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: instant("published_at"),
    cancelledAt: instant("cancelled_at"),
    completedAt: instant("completed_at"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [
    check("event_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "event_capacity_positive",
      sql`${t.capacity} IS NULL OR ${t.capacity} > 0`
    ),
    check(
      "event_registration_window",
      sql`(${t.registrationOpensAt} IS NULL OR ${t.registrationOpensAt} < coalesce(${t.registrationClosesAt}, ${t.startsAt})) AND (${t.registrationClosesAt} IS NULL OR ${t.registrationClosesAt} <= ${t.endsAt})`
    ),
    check(
      "event_publication_stamped",
      sql`${t.status} NOT IN ('published','completed') OR ${t.publishedAt} IS NOT NULL`
    ),
    index("event_status_start_idx").on(t.status, t.startsAt),
    index("event_creator_idx").on(t.createdByUserId),
  ]
);
export type EventRow = typeof event.$inferSelect;

export const eventRegistration = pgTable(
  "event_registration",
  {
    id: uuid().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    subjectUserId: uuid("subject_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    subjectProfileId: uuid("subject_profile_id").references(
      () => participantProfile.id,
      { onDelete: "cascade" }
    ),
    registeredByUserId: uuid("registered_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    checkedInByUserId: uuid("checked_in_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: eventRegistrationStatus().notNull(),
    registeredAt: instant("registered_at").notNull(),
    waitlistOrder: integer("waitlist_order"),
    waitlistedAt: instant("waitlisted_at"),
    promotedAt: instant("promoted_at"),
    cancelledAt: instant("cancelled_at"),
    checkedInAt: instant("checked_in_at"),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [
    check(
      "event_registration_one_subject",
      sql`num_nonnulls(${t.subjectUserId}, ${t.subjectProfileId}) = 1`
    ),
    check(
      "event_registration_waitlist_stamped",
      sql`(${t.waitlistedAt} IS NULL) = (${t.waitlistOrder} IS NULL) AND (${t.status} <> 'waitlisted' OR (${t.waitlistOrder} IS NOT NULL AND ${t.waitlistOrder} > 0))`
    ),
    check(
      "event_registration_checkin_stamped",
      sql`(${t.status} = 'checked_in') = (${t.checkedInAt} IS NOT NULL)`
    ),
    uniqueIndex("event_registration_unique_user")
      .on(t.eventId, t.subjectUserId)
      .where(
        sql`${t.status} <> 'cancelled' AND ${t.subjectUserId} IS NOT NULL`
      ),
    uniqueIndex("event_registration_unique_profile")
      .on(t.eventId, t.subjectProfileId)
      .where(
        sql`${t.status} <> 'cancelled' AND ${t.subjectProfileId} IS NOT NULL`
      ),
    uniqueIndex("event_registration_waitlist_order").on(
      t.eventId,
      t.waitlistOrder
    ),
    index("event_registration_queue_idx").on(
      t.eventId,
      t.status,
      t.waitlistOrder
    ),
    index("event_registration_user_idx").on(t.subjectUserId),
    index("event_registration_profile_idx").on(t.subjectProfileId),
    index("event_registration_booker_idx").on(t.registeredByUserId),
    index("event_registration_checker_idx").on(t.checkedInByUserId),
  ]
);
export type EventRegistrationRow = typeof eventRegistration.$inferSelect;
