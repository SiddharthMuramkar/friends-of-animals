// The breach log (#116): personal-data breaches FOA records, what happened
// to each over time, and who was told.
//
// Staff record a breach when FOA becomes aware of it (`breach_record`). Its
// status follows the transition table in
// src/server/modules/breaches/domain/breach-status.ts. Every change appends
// a `breach_timeline_event`; that table is append-only (a trigger refuses
// UPDATE, TRUNCATE and any DELETE but the one deleting its breach cascades
// to; see drizzle/*_116_breach_timeline_append_only.sql).
//
// Each notice to an affected person is one `breach_notification` row per
// channel, unique per (breach, recipient, channel): a replay inserts
// nothing, so it sends nothing (src/server/modules/breaches/notify.ts).
// Someone a notice can't reach (a child with no guardian, an adult with no
// account) is a `breach_unreachable` row, so staff see the gap.
//
// Free text staff type may hold personal data: the impact, the authority's
// reference and each timeline note are encrypted by the field cipher (#58),
// in columns ending in `_ciphertext`. The title stays plain for the list;
// the form asks staff not to name people in it. Every personal-data column
// is in the data inventory (src/server/modules/privacy/inventory.ts).
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  BREACH_SEVERITIES,
  BREACH_STATUSES,
  BREACH_TIMELINE_KINDS,
} from "../../modules/breaches/domain/breach-status";
import {
  AFFECTED_REF_TYPES,
  NOTICE_RECIPIENT_ROLES,
  UNREACHABLE_REASONS,
} from "../../modules/breaches/domain/notice-recipients";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";
import { messageChannelEnum } from "./notifications";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const breachStatusEnum = pgEnum("breach_status", BREACH_STATUSES);

export const breachSeverityEnum = pgEnum("breach_severity", BREACH_SEVERITIES);

export const breachTimelineKindEnum = pgEnum(
  "breach_timeline_kind",
  BREACH_TIMELINE_KINDS
);

export const breachNoticeRoleEnum = pgEnum(
  "breach_notice_role",
  NOTICE_RECIPIENT_ROLES
);

export const breachSubjectTypeEnum = pgEnum(
  "breach_subject_type",
  AFFECTED_REF_TYPES
);

export const breachUnreachableReasonEnum = pgEnum(
  "breach_unreachable_reason",
  UNREACHABLE_REASONS
);

export const breachRecord = pgTable(
  "breach_record",
  {
    id: uuid().primaryKey(),
    /** A short label for the list; staff are asked not to name people. */
    title: text().notNull(),
    /** When FOA learnt of it; never after the record was made. */
    awareAt: timestamptz("aware_at").notNull(),
    severity: breachSeverityEnum().notNull(),
    personalDataInvolved: boolean("personal_data_involved").notNull(),
    minorsAffected: boolean("minors_affected").notNull(),
    /** A best estimate of how many people, refined as staff learn more. */
    affectedCount: integer("affected_count").notNull(),
    /** What happened and what it means for the people affected. */
    impact: encryptedText("impact_ciphertext").notNull(),
    status: breachStatusEnum().notNull().default("open"),
    containedAt: timestamptz("contained_at"),
    /** The first notice to affected people. */
    principalsNotifiedAt: timestamptz("principals_notified_at"),
    /** When the authority was told: emailed, or filed by hand. */
    authorityNotifiedAt: timestamptz("authority_notified_at"),
    /** The reference the authority gave a notice filed by hand. */
    authorityReference: encryptedText("authority_reference_ciphertext"),
    /**
     * When the authority's email left through the email port: the outbox
     * handler's mark, so it sends once (src/server/modules/breaches/
     * authority.ts). Null for a notice filed by hand.
     */
    authorityEmailSentAt: timestamptz("authority_email_sent_at"),
    closedAt: timestamptz("closed_at"),
    /** Who recorded it and leads the response; null once their account is gone. */
    leadUserId: uuid("lead_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check(
      "breach_record_affected_count_not_negative",
      sql`${table.affectedCount} >= 0`
    ),
    check(
      "breach_record_closed_has_closed_at",
      sql`(${table.status} = 'closed') = (${table.closedAt} IS NOT NULL)`
    ),
    check(
      "breach_record_contained_has_contained_at",
      sql`${table.status} <> 'contained' OR ${table.containedAt} IS NOT NULL`
    ),
    check(
      "breach_record_notified_has_a_notice",
      sql`${table.status} <> 'notified' OR ${table.principalsNotifiedAt} IS NOT NULL OR ${table.authorityNotifiedAt} IS NOT NULL`
    ),
    check(
      "breach_record_reference_after_notice",
      sql`${table.authorityReference} IS NULL OR ${table.authorityNotifiedAt} IS NOT NULL`
    ),
    // The log: open breaches first, newest awareness first.
    index("breach_record_status_aware_at_idx").on(
      table.status,
      table.awareAt.desc()
    ),
  ]
);

export type BreachRecordRow = typeof breachRecord.$inferSelect;

export const breachTimelineEvent = pgTable(
  "breach_timeline_event",
  {
    id: uuid().primaryKey(),
    breachId: uuid("breach_id")
      .notNull()
      .references(() => breachRecord.id, { onDelete: "cascade" }),
    kind: breachTimelineKindEnum().notNull(),
    /** A note, or why a breach closed with no notice; null otherwise. */
    note: encryptedText("note_ciphertext"),
    /**
     * Who made the change; null for the platform's own fan-out. No foreign
     * key: ON DELETE SET NULL would update this table, which the trigger
     * refuses.
     */
    authorUserId: uuid("author_user_id"),
    occurredAt: timestamptz("occurred_at").notNull(),
  },
  (table) => [
    check(
      "breach_timeline_event_note_has_text",
      sql`${table.kind} <> 'note' OR ${table.note} IS NOT NULL`
    ),
    index("breach_timeline_event_breach_id_idx").on(
      table.breachId,
      table.occurredAt
    ),
  ]
);

export type BreachTimelineEventRow = typeof breachTimelineEvent.$inferSelect;

export const breachNotification = pgTable(
  "breach_notification",
  {
    id: uuid().primaryKey(),
    breachId: uuid("breach_id")
      .notNull()
      .references(() => breachRecord.id, { onDelete: "cascade" }),
    /** Who was told; null once their account is gone. */
    recipientUserId: uuid("recipient_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    channel: messageChannelEnum().notNull(),
    /** About themselves, as a guardian, or both. */
    recipientRole: breachNoticeRoleEnum("recipient_role").notNull(),
    /** How many affected people the notice was about. */
    aboutCount: integer("about_count").notNull(),
    /** When the notice was queued; #69's delivery row says when it went. */
    queuedAt: timestamptz("queued_at").notNull(),
  },
  (table) => [
    unique("breach_notification_once").on(
      table.breachId,
      table.recipientUserId,
      table.channel
    ),
    check("breach_notification_about_someone", sql`${table.aboutCount} >= 1`),
  ]
);

export type BreachNotificationRow = typeof breachNotification.$inferSelect;

export const breachUnreachable = pgTable(
  "breach_unreachable",
  {
    breachId: uuid("breach_id")
      .notNull()
      .references(() => breachRecord.id, { onDelete: "cascade" }),
    subjectType: breachSubjectTypeEnum("subject_type").notNull(),
    /** The account or profile; no foreign key, as it is either. */
    subjectId: uuid("subject_id").notNull(),
    reason: breachUnreachableReasonEnum().notNull(),
    recordedAt: timestamptz("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "breach_unreachable_pk",
      columns: [table.breachId, table.subjectType, table.subjectId],
    }),
  ]
);

export type BreachUnreachableRow = typeof breachUnreachable.$inferSelect;
