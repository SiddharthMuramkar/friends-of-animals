// Privacy rights requests (#115). A data principal, or a guardian for a
// linked child, files an access, correction or erasure request; FOA's
// grievance officer works it from a queue with due dates. A request names
// whose data it is as (subject_kind, subject_id): the requester's own
// account, or a guardian-managed participant profile.
//
// `privacy_request_note` holds the officers' internal notes. The app only
// ever appends to it (no use case edits or deletes a note); there is no
// trigger, so the retention policy can delete a closed request with its
// notes three years after it closed (src/server/privacy/requests/inventory.ts).
//
// `privacy_overdue_digest` records each IST day the daily overdue run sent
// its digest, so a second run that day sends nothing.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  PRIVACY_SUBJECT_KINDS,
  REQUEST_RELATIONS,
} from "../../privacy/requests/domain/filing";
import {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
} from "../../privacy/requests/domain/request-status";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const privacyRequestType = pgEnum(
  "privacy_request_type",
  PRIVACY_REQUEST_TYPES
);

export const privacyRequestStatus = pgEnum(
  "privacy_request_status",
  PRIVACY_REQUEST_STATUSES
);

export const privacyRequestRelation = pgEnum(
  "privacy_request_relation",
  REQUEST_RELATIONS
);

export const privacySubjectKind = pgEnum(
  "privacy_subject_kind",
  PRIVACY_SUBJECT_KINDS
);

/** Longest correction details or internal note, in characters. */
export const PRIVACY_REQUEST_TEXT_MAX = 2000;

/** Longest rejection reason or resolution, in characters. */
export const PRIVACY_REQUEST_REASON_MAX = 1000;

export const privacyRequest = pgTable(
  "privacy_request",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    /** What the requester quotes, e.g. `PR-27-8H3TZQ`. */
    reference: text().notNull(),
    type: privacyRequestType().notNull(),
    status: privacyRequestStatus().notNull(),
    relation: privacyRequestRelation().notNull(),
    subjectKind: privacySubjectKind("subject_kind").notNull(),
    /**
     * The account or participant profile the request is about. No foreign
     * key: it points at a different table per subject kind.
     */
    subjectId: uuid("subject_id").notNull(),
    /**
     * Who filed it. Deleting that account is refused while a request names
     * it: erasure anonymises the account instead, and the request stays
     * until its retention period ends.
     */
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => user.id),
    /** What to correct; only a correction request has it. */
    correctionDetails: text("correction_details"),
    dueAt: timestamptz("due_at").notNull(),
    /** The grievance officer working it; null until assigned or started. */
    assignedToUserId: uuid("assigned_to_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** What FOA did, shown to the requester once it is completed. */
    resolutionNote: text("resolution_note"),
    /** Why FOA refused it, shown to the requester. */
    rejectionReason: text("rejection_reason"),
    createdAt: timestamptz("created_at").notNull(),
    /** When work started: first assigned or started. */
    startedAt: timestamptz("started_at"),
    /** When it was completed, rejected or cancelled. */
    closedAt: timestamptz("closed_at"),
  },
  (table) => [
    unique("privacy_request_reference_unique").on(table.reference),
    // The queue: open requests, earliest due first.
    index("privacy_request_status_due_at_idx").on(table.status, table.dueAt),
    // A requester's own requests, newest first.
    index("privacy_request_requested_by_idx").on(
      table.requestedByUserId,
      table.createdAt.desc()
    ),
    // Everything about one data principal (export and erasure, 115b).
    index("privacy_request_subject_idx").on(table.subjectKind, table.subjectId),
    index("privacy_request_assigned_to_idx").on(table.assignedToUserId),
    // Retention looks for requests closed long enough ago.
    index("privacy_request_closed_at_idx")
      .on(table.closedAt)
      .where(sql`${table.closedAt} IS NOT NULL`),
    // A self request is about the requester's account; a guardian's is
    // about a participant profile.
    check(
      "privacy_request_relation_matches_subject",
      sql`(${table.relation} = 'self') = (${table.subjectKind} = 'user')`
    ),
    check(
      "privacy_request_self_is_requester",
      sql`${table.relation} <> 'self' OR ${table.subjectId} = ${table.requestedByUserId}`
    ),
    check(
      "privacy_request_correction_details_for_correction",
      sql`(${table.type} = 'correction') = (${table.correctionDetails} IS NOT NULL)`
    ),
    check(
      "privacy_request_closed_at_when_closed",
      sql`(${table.status} IN ('submitted', 'in_progress')) = (${table.closedAt} IS NULL)`
    ),
    check(
      "privacy_request_started_at_once_started",
      sql`${table.status} NOT IN ('in_progress', 'completed', 'partially_completed') OR ${table.startedAt} IS NOT NULL`
    ),
    check(
      "privacy_request_rejection_reason_when_rejected",
      sql`(${table.status} = 'rejected') = (${table.rejectionReason} IS NOT NULL)`
    ),
    check(
      "privacy_request_resolution_when_completed",
      sql`${table.resolutionNote} IS NULL OR ${table.status} IN ('completed', 'partially_completed')`
    ),
    // A null column passes: BETWEEN on null is unknown, not false.
    check(
      "privacy_request_text_lengths",
      sql`char_length(${table.correctionDetails}) BETWEEN 1 AND ${sql.raw(String(PRIVACY_REQUEST_TEXT_MAX))} AND char_length(${table.resolutionNote}) BETWEEN 1 AND ${sql.raw(String(PRIVACY_REQUEST_REASON_MAX))} AND char_length(${table.rejectionReason}) BETWEEN 1 AND ${sql.raw(String(PRIVACY_REQUEST_REASON_MAX))}`
    ),
  ]
);

export type PrivacyRequestRow = typeof privacyRequest.$inferSelect;

export const privacyRequestNote = pgTable(
  "privacy_request_note",
  {
    id: uuid().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequest.id, { onDelete: "cascade" }),
    /** The officer who wrote it; null once their account is gone. */
    authorUserId: uuid("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    body: text().notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("privacy_request_note_request_idx").on(
      table.requestId,
      table.createdAt
    ),
    index("privacy_request_note_author_idx").on(table.authorUserId),
    check(
      "privacy_request_note_body_length",
      sql`char_length(${table.body}) BETWEEN 1 AND ${sql.raw(String(PRIVACY_REQUEST_TEXT_MAX))}`
    ),
  ]
);

export type PrivacyRequestNoteRow = typeof privacyRequestNote.$inferSelect;

export const privacyOverdueDigest = pgTable(
  "privacy_overdue_digest",
  {
    id: uuid().primaryKey(),
    /** The IST calendar day the digest went out, e.g. "2027-02-15". */
    digestDate: date("digest_date", { mode: "string" }).notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    unique("privacy_overdue_digest_date_unique").on(table.digestDate),
  ]
);
