// Privacy rights requests (#115). A signed-in user files an access,
// correction or erasure request about their own data, or a verified
// guardian files one for a linked child; FOA's grievance officer works the
// queue (src/server/modules/privacy/requests). The request names whose data
// it is as `(subject_kind, subject_id)`: an account or a guardian-managed
// participant profile. That id has no foreign key, so the request outlives
// an erasure as its record.
//
// Personal data: the correction details the requester typed, the reason a
// request was refused, the officer's resolution and the officer's notes,
// all encrypted with the field cipher; and the accounts named. The data
// inventory lists every column (src/server/modules/privacy/inventory.ts).
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  PRIVACY_SUBJECT_KINDS,
  REQUEST_RELATIONS,
} from "../../modules/privacy/requests/domain/filing";
import {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
} from "../../modules/privacy/requests/domain/request-status";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const privacyRequestTypeEnum = pgEnum(
  "privacy_request_type",
  PRIVACY_REQUEST_TYPES
);

/** Every status from the start (ADR 0004): no later value, no rule F2 step. */
export const privacyRequestStatusEnum = pgEnum(
  "privacy_request_status",
  PRIVACY_REQUEST_STATUSES
);

export const privacyRequestRelationEnum = pgEnum(
  "privacy_request_relation",
  REQUEST_RELATIONS
);

export const privacySubjectKindEnum = pgEnum(
  "privacy_subject_kind",
  PRIVACY_SUBJECT_KINDS
);

/** The constraint `withUniqueCode` retries on when a reference is taken. */
export const PRIVACY_REQUEST_REFERENCE_UNIQUE =
  "privacy_request_reference_unique";

/** A category of data an erasure kept, as the requester is told. */
export type RetainedCategory = {
  category: string;
  basis: string;
  /** When the basis stops applying; null when it has no end date. */
  until: string | null;
};

export const privacyRequest = pgTable(
  "privacy_request",
  {
    id: uuid().primaryKey(),
    /** `PR-27-8H3TZQ`: the reference the requester quotes. */
    reference: text().notNull(),
    type: privacyRequestTypeEnum().notNull(),
    status: privacyRequestStatusEnum().notNull().default("submitted"),
    relation: privacyRequestRelationEnum().notNull(),
    subjectKind: privacySubjectKindEnum("subject_kind").notNull(),
    /** The account or participant profile, by id; no foreign key. */
    subjectId: uuid("subject_id").notNull(),
    /** Who filed it; null once their account is gone (an erasure). */
    requestedByUserId: uuid("requested_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** What the requester says is wrong, encrypted; corrections only. */
    correctionDetails: encryptedText("correction_details_ciphertext"),
    /** The grievance officer working it; null until assigned. */
    assignedToUserId: uuid("assigned_to_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Filed + the due period for its type (privacy.*DueDays). */
    dueAt: timestamptz("due_at").notNull(),
    startedAt: timestamptz("started_at"),
    /** When it reached a final status. */
    closedAt: timestamptz("closed_at"),
    /** Why the officer refused it, encrypted; the requester reads it. */
    rejectionReason: encryptedText("rejection_reason_ciphertext"),
    /** What the officer did about a correction, encrypted. */
    resolution: encryptedText("resolution_ciphertext"),
    // The data export of an access request (#115b). The ZIP is in the
    // private bucket under a key made from this row's id, and only the
    // requester downloads it, never staff.
    exportRequestedAt: timestamptz("export_requested_at"),
    exportStorageKey: text("export_storage_key"),
    exportReadyAt: timestamptz("export_ready_at"),
    /** The link stops working, and the object is deleted, at this instant. */
    exportExpiresAt: timestamptz("export_expires_at"),
    exportDeletedAt: timestamptz("export_deleted_at"),
    // An erasure the officer approved (#115b): the plan's fingerprint they
    // saw, which the job must find unchanged before it erases anything.
    erasureFingerprint: text("erasure_fingerprint"),
    erasureApprovedByUserId: uuid("erasure_approved_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    erasureApprovedAt: timestamptz("erasure_approved_at"),
    /**
     * Why an approved erasure didn't run: the plan changed meanwhile, or
     * erasure was switched off (privacy.erasureEnabled).
     */
    erasureFailure: text("erasure_failure").$type<
      "plan_changed" | "erasure_disabled"
    >(),
    /** What an erasure kept, and why: categories only, never records. */
    retained: jsonb().$type<RetainedCategory[]>(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex(PRIVACY_REQUEST_REFERENCE_UNIQUE).on(table.reference),
    check(
      "privacy_request_reference_format",
      sql`${table.reference} ~ '^PR-[0-9]{2}-[0-9A-HJKMNP-TV-Z]{6}$'`
    ),
    // Only a correction says what to correct, and every correction does.
    check(
      "privacy_request_correction_details",
      sql`(${table.type} = 'correction') = (${table.correctionDetails} IS NOT NULL)`
    ),
    // A guardian files only for a child's profile.
    check(
      "privacy_request_guardian_subject",
      sql`${table.relation} <> 'guardian' OR ${table.subjectKind} = 'participant_profile'`
    ),
    check(
      "privacy_request_closed_at",
      sql`(${table.status} IN ('submitted', 'in_progress')) = (${table.closedAt} IS NULL)`
    ),
    check(
      "privacy_request_rejection_reason",
      sql`(${table.status} = 'rejected') = (${table.rejectionReason} IS NOT NULL)`
    ),
    check(
      "privacy_request_partial_is_erasure",
      sql`${table.status} <> 'partially_completed' OR ${table.type} = 'erasure'`
    ),
    check(
      "privacy_request_export_is_access",
      sql`${table.exportRequestedAt} IS NULL OR ${table.type} = 'access'`
    ),
    check(
      "privacy_request_export_ready",
      sql`(${table.exportReadyAt} IS NULL) = (${table.exportStorageKey} IS NULL) AND (${table.exportReadyAt} IS NULL) = (${table.exportExpiresAt} IS NULL)`
    ),
    check(
      "privacy_request_erasure_approval",
      sql`(${table.erasureFingerprint} IS NULL OR ${table.type} = 'erasure') AND (${table.erasureFingerprint} IS NULL) = (${table.erasureApprovedAt} IS NULL)`
    ),
    // The queue: open requests, earliest due first.
    index("privacy_request_status_due_idx").on(table.status, table.dueAt),
    // A requester's own list, newest first.
    index("privacy_request_requested_by_idx").on(
      table.requestedByUserId,
      table.createdAt.desc()
    ),
    // A guardian sees a teen's requests; erasure finds a subject's.
    index("privacy_request_subject_idx").on(table.subjectKind, table.subjectId),
    // Deleting a user sets these to null; the indexes keep that from scanning.
    index("privacy_request_assigned_to_idx").on(table.assignedToUserId),
    index("privacy_request_erasure_approved_by_idx").on(
      table.erasureApprovedByUserId
    ),
  ]
);

export type PrivacyRequestRow = typeof privacyRequest.$inferSelect;

/**
 * The grievance officer's internal notes on a request: never shown to the
 * requester, never edited (no use case changes one). Deleted with the
 * request.
 */
export const privacyRequestNote = pgTable(
  "privacy_request_note",
  {
    id: uuid().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequest.id, { onDelete: "cascade" }),
    /** Null once the officer's account is gone. */
    authorUserId: uuid("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    body: encryptedText("body_ciphertext").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("privacy_request_note_request_idx").on(table.requestId, table.id),
    index("privacy_request_note_author_idx").on(table.authorUserId),
  ]
);

/**
 * One row per India day the overdue digest went out (#115), so a second
 * run that day sends nothing. Counts only.
 */
export const privacyOverdueDigest = pgTable("privacy_overdue_digest", {
  /** `YYYY-MM-DD`, the IST calendar day. */
  day: text().primaryKey(),
  overdue: integer().notNull(),
  sentAt: timestamptz("sent_at").notNull(),
});

/** One kind of record and what an erasure did with it (#115b). */
export type ErasureCategoryRecord = {
  key: string;
  action: "withdraw" | "delete" | "anonymise" | "retain";
  basis: string | null;
  until: string | null;
  count: number;
};

/**
 * The record of an erasure (#115b): whose, when, what was done with each
 * kind of record and what was kept. It outlives the request, so a backup
 * restored later can be erased again (an owner procedure, HR-30), and
 * holds ids only, never a name or a contact.
 */
export const erasureRecord = pgTable(
  "erasure_record",
  {
    id: uuid().primaryKey(),
    /** Null once retention deletes the request. */
    requestId: uuid("request_id").references(() => privacyRequest.id, {
      onDelete: "set null",
    }),
    subjectKind: privacySubjectKindEnum("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    /** Every account and profile the erasure covered. */
    userIds: uuid("user_ids").array().notNull(),
    profileIds: uuid("profile_ids").array().notNull(),
    outcome: text().$type<"completed" | "partially_completed">().notNull(),
    categories: jsonb().$type<ErasureCategoryRecord[]>().notNull(),
    /** The latest date a kept kind's basis lapses; null if none does. */
    retainedUntil: timestamptz("retained_until"),
    erasedAt: timestamptz("erased_at").notNull(),
  },
  (table) => [
    check(
      "erasure_record_outcome",
      sql`${table.outcome} IN ('completed', 'partially_completed')`
    ),
    index("erasure_record_request_idx").on(table.requestId),
    index("erasure_record_subject_idx").on(table.subjectKind, table.subjectId),
  ]
);
