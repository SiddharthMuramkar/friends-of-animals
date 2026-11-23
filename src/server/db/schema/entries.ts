// Entries (#85). A confirmed registration has at most one entry: the work a
// participant submits, with its Entry ID, its words and its status. Each
// upload is an entry file with a status of its own, so a replacement is
// checked while the entry stays submitted and its current file stays live
// (src/server/modules/entries/domain/status.ts). Every change of an entry's
// status is kept in entry_transition, so later rounds can show and revert
// the history.
//
// Loads under plain Node (drizzle-kit, the worker): relative imports only,
// no "server-only".

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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ENTRY_TEXT_LIMITS,
  type EntryText,
} from "../../modules/entries/domain/entry-text";
import { ENTRY_FILE_KINDS } from "../../modules/entries/domain/file-kinds";
import {
  ENTRY_FILE_STATUSES,
  ENTRY_STATUSES,
} from "../../modules/entries/domain/status";
import { competition, competitionDisciplineEnum } from "./competitions";
import { fileAsset } from "./files";
import { user } from "./identity";
import { participantProfile, registration } from "./registration";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Every value the digital rounds need, from the first migration: later
 * tickets add allowed moves, never values (a value added and used in one
 * migration run fails).
 */
export const entryStatus = pgEnum("entry_status", ENTRY_STATUSES);

export const entryFileStatus = pgEnum("entry_file_status", ENTRY_FILE_STATUSES);

export const entryFileKind = pgEnum("entry_file_kind", ENTRY_FILE_KINDS);

/** The Entry ID: the competition's code, -E- and six Crockford symbols. */
const ENTRY_CODE_PATTERN = "^[A-Z]{3,6}[0-9]{2}-E-[0-9A-HJKMNP-TV-Z]{6}$";

export const entry = pgTable(
  "entry",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    /** The Entry ID people see and quote, such as PAWS27-E-7K3QZ9. */
    code: text().notNull(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    /** One entry per registration: a second upload replaces the file. */
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registration.id),
    /** Whose work it is: the participant, adult or minor. */
    participantProfileId: uuid("participant_profile_id")
      .notNull()
      .references(() => participantProfile.id),
    /**
     * Which of the competition's disciplines the work is in, chosen with
     * the first upload; with the registration's age group it makes the
     * category it is judged in.
     */
    discipline: competitionDisciplineEnum().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    statement: text(),
    status: entryStatus().notNull(),
    /**
     * Who uploaded first: the participant, or their guardian. Null for seed
     * data, or once that account is gone.
     */
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** When its first file became live and the entry counted as submitted. */
    submittedAt: timestamptz("submitted_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    unique("entry_code_unique").on(table.code),
    unique("entry_registration_id_unique").on(table.registrationId),
    check(
      "entry_code_format",
      sql`${table.code} ~ ${sql.raw(`'${ENTRY_CODE_PATTERN}'`)}`
    ),
    check(
      "entry_title_length",
      sql`char_length(${table.title}) BETWEEN 1 AND ${sql.raw(String(ENTRY_TEXT_LIMITS.title))}`
    ),
    check(
      "entry_description_length",
      sql`char_length(${table.description}) BETWEEN 1 AND ${sql.raw(String(ENTRY_TEXT_LIMITS.description))}`
    ),
    check(
      "entry_statement_length",
      sql`${table.statement} IS NULL OR char_length(${table.statement}) BETWEEN 1 AND ${sql.raw(String(ENTRY_TEXT_LIMITS.statement))}`
    ),
    // A submitted entry has its instant; an entry that has never had a
    // live file (processing, rejected, failed) has none. Later statuses
    // keep whatever the entry had.
    check(
      "entry_submitted_at_matches_status",
      sql`(${table.status} <> 'submitted' OR ${table.submittedAt} IS NOT NULL) AND (${table.status} NOT IN ('processing', 'rejected', 'failed') OR ${table.submittedAt} IS NULL)`
    ),
    // The participant's dashboard lists their entries; staff list a
    // competition's by status.
    index("entry_participant_profile_id_idx").on(table.participantProfileId),
    index("entry_competition_id_status_idx").on(
      table.competitionId,
      table.status
    ),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("entry_created_by_user_id_idx").on(table.createdByUserId),
  ]
);

export type EntryRow = typeof entry.$inferSelect;

export const entryFile = pgTable(
  "entry_file",
  {
    /** Stable reference for this upload attempt. */
    id: uuid().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade" }),
    /** Acceptance order within the entry, assigned under its lock. */
    attemptNumber: integer("attempt_number").notNull(),
    kind: entryFileKind().notNull(),
    /** The uploaded file (#63); null only for a typed essay (#86). */
    fileAssetId: uuid("file_asset_id").references(() => fileAsset.id),
    status: entryFileStatus().notNull(),
    /** Text waiting to be published with a replacement for a live image. */
    pendingText: jsonb("pending_text").$type<EntryText>(),
    /** The title at submission for the adult participant's receipt. */
    receiptTitle: text("receipt_title"),
    /** Null for seed data, or once that account is gone. */
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** When the upload was confirmed: what counts against the deadline. */
    uploadCompletedAt: timestamptz("upload_completed_at").notNull(),
    becameLiveAt: timestamptz("became_live_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // An uploaded file belongs to one entry file; completing it again
    // finds the row instead of adding one.
    unique("entry_file_file_asset_id_unique").on(table.fileAssetId),
    // The entry's current file: at most one.
    uniqueIndex("entry_file_one_live_per_entry")
      .on(table.entryId)
      .where(sql`${table.status} = 'live'`),
    check(
      "entry_file_asset_matches_kind",
      sql`(${table.kind} = 'text') = (${table.fileAssetId} IS NULL)`
    ),
    // A live file has the instant it went live; a file that never did has
    // none. A superseded one may have been either.
    check(
      "entry_file_became_live_at_matches_status",
      sql`(${table.status} <> 'live' OR ${table.becameLiveAt} IS NOT NULL) AND (${table.status} NOT IN ('pending', 'processing', 'rejected', 'failed') OR ${table.becameLiveAt} IS NULL)`
    ),
    unique("entry_file_entry_id_attempt_number_unique").on(
      table.entryId,
      table.attemptNumber
    ),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("entry_file_uploaded_by_user_id_idx").on(table.uploadedByUserId),
  ]
);

export type EntryFileRow = typeof entryFile.$inferSelect;

/** A short-lived grant to upload an image for one registration. */
export const entryUploadGrant = pgTable(
  "entry_upload_grant",
  {
    fileAssetId: uuid("file_asset_id")
      .primaryKey()
      .references(() => fileAsset.id, { onDelete: "cascade" }),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registration.id),
    uploadKey: text("upload_key").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    /** The object has been taken from the PUT key and checked. */
    prepared: boolean().notNull().default(false),
    /** The uploader chose another file. Keep tracking the signed URL until expiry. */
    retired: boolean().notNull().default(false),
  },
  (table) => [
    index("entry_upload_grant_registration_expiry_idx").on(
      table.registrationId,
      table.expiresAt
    ),
  ]
);

/** A participant or guardian, or the platform (the worker applying an outcome). */
export const ENTRY_ACTOR_KINDS = ["user", "system"] as const;

/** One change of an entry's status: the history later rounds show and revert. */
export const entryTransition = pgTable(
  "entry_transition",
  {
    /** UUIDv7 from the clock, so an entry's history sorts in order. */
    id: uuid().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade" }),
    /** Null when this move created the entry. */
    fromStatus: entryStatus("from_status"),
    toStatus: entryStatus("to_status").notNull(),
    /** What moved it (EntryTrigger in domain/status.ts). */
    trigger: text().notNull(),
    /** The file whose upload or outcome moved it. */
    entryFileId: uuid("entry_file_id").references(() => entryFile.id, {
      onDelete: "cascade",
    }),
    actorKind: text("actor_kind", { enum: ENTRY_ACTOR_KINDS }).notNull(),
    /** The acting user; null for the platform, or once the account is gone. */
    actorUserId: uuid("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    at: timestamptz("at").notNull(),
  },
  (table) => [
    check(
      "entry_transition_actor_kind",
      sql`${table.actorKind} IN ('user', 'system')`
    ),
    check(
      "entry_transition_system_has_no_user",
      sql`${table.actorKind} = 'user' OR ${table.actorUserId} IS NULL`
    ),
    check(
      "entry_transition_changes_status",
      sql`${table.fromStatus} IS DISTINCT FROM ${table.toStatus}`
    ),
    index("entry_transition_entry_id_idx").on(table.entryId, table.id),
    index("entry_transition_entry_file_id_idx").on(table.entryFileId),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("entry_transition_actor_user_id_idx").on(table.actorUserId),
  ]
);

export type EntryTransitionRow = typeof entryTransition.$inferSelect;
