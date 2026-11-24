// Notifications (#69): the message templates staff edit, the routes that
// say which messages each domain event sends, one row per message
// delivered (or held back) on one channel, the in-app inbox, and each
// user's channel choices.
//
// The default templates and routes are data, put there by
// drizzle/*_69_notification_defaults.sql, so every environment has them,
// production included (it is never seeded).
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
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { MESSAGE_CHANNELS } from "../../modules/notifications/domain/channels";
import { SUPPRESSION_REASONS } from "../../modules/notifications/domain/delivery-plan";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const messageChannelEnum = pgEnum("message_channel", MESSAGE_CHANNELS);

/**
 * `pending` until the port took it; `failed` is retried with the event.
 * `sending` (#84): claimed by one run for an external destination,
 * so an overlapping run of the same event doesn't send it too.
 */
export const messageDeliveryStatusEnum = pgEnum("message_delivery_status", [
  "pending",
  "sent",
  "failed",
  "suppressed",
  "sending",
]);

export const messageSuppressionReasonEnum = pgEnum(
  "message_suppression_reason",
  SUPPRESSION_REASONS
);

/**
 * One template on one channel in one locale. Every key has an email and an
 * in-app row; SMS is optional. Each saved edit raises `version`.
 */
export const messageTemplate = pgTable(
  "message_template",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** `<module>.<message>`, such as `identity.welcome`. */
    key: text().notNull(),
    channel: messageChannelEnum().notNull(),
    locale: text().notNull().default("en-IN"),
    /** Email subject or in-app title; null for SMS. */
    subject: text(),
    /** Plain text with `{{variable}}` placeholders; never HTML. */
    body: text().notNull(),
    /** The variables it may use: set by code and migrations, never edits. */
    variables: jsonb().$type<string[]>().notNull(),
    /** SMS only: the DLT template id its wording is registered under. */
    dltTemplateId: text("dlt_template_id"),
    version: integer().notNull().default(1),
    /** Null for the defaults, or once the editor's account is gone. */
    updatedByUserId: uuid("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    unique("message_template_key_channel_locale_unique").on(
      table.key,
      table.channel,
      table.locale
    ),
    check("message_template_version_positive", sql`${table.version} > 0`),
    check(
      "message_template_sms_no_subject",
      sql`${table.channel} <> 'sms' OR ${table.subject} IS NULL`
    ),
    check(
      "message_template_dlt_sms_only",
      sql`${table.channel} = 'sms' OR ${table.dltTemplateId} IS NULL`
    ),
  ]
);

export type MessageTemplateRow = typeof messageTemplate.$inferSelect;

/**
 * Which message an event sends, to whom and on which channels. An event
 * type with no enabled route sends nothing.
 */
export const messageRoute = pgTable(
  "message_route",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** A DomainEvent type, such as `identity.user_signed_up`. */
    eventType: text("event_type").notNull(),
    /** A key in src/server/modules/notifications/audiences.ts. */
    audience: text().notNull(),
    templateKey: text("template_key").notNull(),
    channels: messageChannelEnum().array().notNull(),
    /** Ignores the user's channel choices and withdrawn messages consent. */
    requiredByLaw: boolean("required_by_law").notNull().default(false),
    enabled: boolean().notNull().default(true),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    unique("message_route_event_audience_template_unique").on(
      table.eventType,
      table.audience,
      table.templateKey
    ),
    check(
      "message_route_has_channels",
      sql`cardinality(${table.channels}) > 0`
    ),
  ]
);

export type MessageRouteRow = typeof messageRoute.$inferSelect;

/**
 * One message for one recipient on one channel, sent or held back. The
 * recipient is a user or an external destination recorded by a blind index
 * of the address (#84). The unique keys make each delivery happen once,
 * however often the outbox delivers the event.
 */
export const messageDelivery = pgTable(
  "message_delivery",
  {
    id: uuid().primaryKey(),
    /** The outbox event (outbox.event_id); no key: outbox rows are purged. */
    eventId: uuid("event_id").notNull(),
    templateKey: text("template_key").notNull(),
    /** The template version rendered; null while held back. */
    templateVersion: integer("template_version"),
    /** The user it went to; null when keyed by destination (`contact_hash`). */
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    /**
     * The blind index of the last attempted destination or of the recipient key when absent.
     */
    contactHash: text("contact_hash"),
    /** Blind index of the account for service messages keyed by destination. */
    recipientAccountHash: text("recipient_account_hash"),
    /** Blind indexes of known addresses for an external delivery. */
    recipientHashes: text("recipient_hashes").array(),
    channel: messageChannelEnum().notNull(),
    status: messageDeliveryStatusEnum().notNull(),
    reason: messageSuppressionReasonEnum(),
    /** Port calls made, failed ones included. */
    attempts: integer().notNull().default(0),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    unique("message_delivery_once").on(
      table.eventId,
      table.templateKey,
      table.userId,
      table.channel
    ),
    unique("message_delivery_contact_once").on(
      table.eventId,
      table.templateKey,
      table.contactHash,
      table.channel
    ),
    check(
      "message_delivery_one_recipient",
      sql`(${table.userId} IS NULL) <> (${table.contactHash} IS NULL)`
    ),
    index("message_delivery_user_idx").on(table.userId),
    index("message_delivery_recipient_account_idx").on(
      table.eventId,
      table.templateKey,
      table.channel,
      table.recipientAccountHash
    ),
    index("message_delivery_recipient_hashes_idx").using(
      "gin",
      table.recipientHashes
    ),
    check(
      "message_delivery_reason_iff_suppressed",
      sql`(${table.status} = 'suppressed') = (${table.reason} IS NOT NULL)`
    ),
  ]
);

export const INBOX_TITLE_PURPOSE = "inbox_item.title";
export const INBOX_BODY_PURPOSE = "inbox_item.body";

/** A message in one user's in-app inbox. */
export const inboxItem = pgTable(
  "inbox_item",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The delivery that made it; null for seed data. */
    deliveryId: uuid("delivery_id")
      .unique()
      .references(() => messageDelivery.id, { onDelete: "set null" }),
    templateKey: text("template_key").notNull(),
    title: text().notNull(),
    body: text().notNull(),
    /** Announcement copy can contain personal help contacts in either field. */
    titleCiphertext: encryptedText("title_ciphertext"),
    bodyCiphertext: encryptedText("body_ciphertext"),
    /** A path on this site (isInboxLink), or null. */
    link: text(),
    createdAt: timestamptz("created_at").notNull(),
    readAt: timestamptz("read_at"),
  },
  (table) => [
    index("inbox_item_user_newest_idx").on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc()
    ),
    index("inbox_item_unread_idx")
      .on(table.userId)
      .where(sql`${table.readAt} IS NULL`),
  ]
);

export type InboxItemRow = typeof inboxItem.$inferSelect;

/** A user's channel choices; no row means both on. */
export const notificationPreference = pgTable("notification_preference", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  email: boolean().notNull(),
  sms: boolean().notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});
