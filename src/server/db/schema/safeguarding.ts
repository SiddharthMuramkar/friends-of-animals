// Safeguarding reports and their incident log (#116).
//
// Anyone files a concern through the public form; only a safeguarding lead
// reads it. Everything a person typed is stored encrypted by the field
// cipher (#58): the description, who it is about, the reporter's name and
// contact, the lead's outcome and authority reference, and every log
// entry's text. Category, status, severity, the child's rough age and the
// two flags stay plain, because the queue filters and sorts on them and
// retention reads the age.
//
// The report holds no IP address, user id or user agent: a concern stays
// anonymous even from FOA, and the windowed rate limiter keeps only keyed
// hashes. The incident log is append-only (a trigger refuses UPDATE and any
// DELETE but the one that deleting its report cascades to; see
// drizzle/*_116_incident_log_append_only.sql).
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { CONCERN_CATEGORIES } from "../../modules/safeguarding/domain/concern";
import {
  INCIDENT_LOG_KINDS,
  SAFEGUARDING_REPORT_STATUSES,
  SAFEGUARDING_SEVERITIES,
} from "../../modules/safeguarding/domain/report-status";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";

export const safeguardingReportStatusEnum = pgEnum(
  "safeguarding_report_status",
  SAFEGUARDING_REPORT_STATUSES
);

export const safeguardingSeverityEnum = pgEnum(
  "safeguarding_severity",
  SAFEGUARDING_SEVERITIES
);

export const incidentLogKindEnum = pgEnum(
  "incident_log_kind",
  INCIDENT_LOG_KINDS
);

export const safeguardingReport = pgTable(
  "safeguarding_report",
  {
    id: uuid().primaryKey(),
    /** `SG-YY-XXXXXX`: for leads to name a case without its details. */
    reference: text().notNull(),
    category: text({ enum: CONCERN_CATEGORIES }).notNull(),
    description: encryptedText().notNull(),
    subjectDetails: encryptedText("subject_details"),
    /** The child's age in whole years, if the reporter knew it (0-17). */
    subjectAge: smallint("subject_age"),
    reporterIsChild: boolean("reporter_is_child").notNull(),
    anonymous: boolean().notNull(),
    reporterName: encryptedText("reporter_name"),
    reporterContact: encryptedText("reporter_contact"),
    status: safeguardingReportStatusEnum().notNull().default("new"),
    /** Set at triage; null while the report is new. */
    severity: safeguardingSeverityEnum(),
    /** The lead handling it. */
    assignedToUserId: uuid("assigned_to_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** The outside authority's reference, once escalated. */
    escalationReference: encryptedText("escalation_reference"),
    /** What was done, once resolved. */
    outcome: encryptedText(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    unique("safeguarding_report_reference_unique").on(table.reference),
    check(
      "safeguarding_report_subject_age_range",
      sql`${table.subjectAge} BETWEEN 0 AND 17`
    ),
    // An anonymous report keeps no way to tell who sent it.
    check(
      "safeguarding_report_anonymous_has_no_reporter",
      sql`NOT ${table.anonymous} OR (${table.reporterName} IS NULL AND ${table.reporterContact} IS NULL)`
    ),
    check(
      "safeguarding_report_severity_after_triage",
      sql`(${table.status} = 'new') = (${table.severity} IS NULL)`
    ),
    check(
      "safeguarding_report_escalated_has_reference",
      sql`${table.status} <> 'escalated' OR ${table.escalationReference} IS NOT NULL`
    ),
    check(
      "safeguarding_report_resolved_has_outcome",
      sql`(${table.status} = 'resolved') = (${table.outcome} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`
    ),
    // The queue: open reports by status, newest first.
    index("safeguarding_report_status_created_at_idx").on(
      table.status,
      table.createdAt.desc()
    ),
    index("safeguarding_report_assigned_to_user_id_idx").on(
      table.assignedToUserId
    ),
  ]
);

export type SafeguardingReportRow = typeof safeguardingReport.$inferSelect;

export const safeguardingIncidentLog = pgTable(
  "safeguarding_incident_log",
  {
    id: uuid().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => safeguardingReport.id, { onDelete: "cascade" }),
    kind: incidentLogKindEnum().notNull(),
    /** For a move: where the report went. */
    toStatus: safeguardingReportStatusEnum("to_status"),
    /** For triage: the severity set. */
    severity: safeguardingSeverityEnum(),
    /** A note, an authority reference or an outcome; null for plain moves. */
    body: encryptedText(),
    /**
     * The lead who wrote it. No foreign key: ON DELETE SET NULL would
     * update this table, which the trigger refuses.
     */
    authorUserId: uuid("author_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "safeguarding_incident_log_note_has_body",
      sql`${table.kind} <> 'note' OR ${table.body} IS NOT NULL`
    ),
    check(
      "safeguarding_incident_log_move_has_status",
      sql`(${table.kind} = 'note') = (${table.toStatus} IS NULL)`
    ),
    index("safeguarding_incident_log_report_id_idx").on(
      table.reportId,
      table.createdAt
    ),
  ]
);

export type SafeguardingIncidentLogRow =
  typeof safeguardingIncidentLog.$inferSelect;
