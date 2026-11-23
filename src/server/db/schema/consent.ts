// Consent (#64): versioned consent documents and the log of consent given
// and withdrawn.
//
// A consent document is never edited. Publishing inserts the next version
// of its purpose, and a trigger refuses any UPDATE, DELETE or TRUNCATE
// (drizzle/*_64_consent_document_immutable.sql), so consent always points
// at the exact text the person saw.
//
// Consent itself is an event log: each give and each withdrawal is one
// row, and the current state for a subject and purpose is its latest
// event (src/server/modules/consent/domain/consent-state.ts).
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
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { ConsentDocumentBody } from "../../modules/consent/domain/document-body";
import {
  CONSENT_METHODS,
  CONSENT_PURPOSES,
  CONSENT_SUBJECT_TYPES,
} from "../../modules/consent/domain/purposes";
import { cmsRevision } from "./cms";
import { competition } from "./competitions";
import { consentForm } from "./consent-forms";
import { user } from "./identity";

/**
 * #82 added the guardian purposes ahead of its DDL
 * (drizzle/*_82_pre_enum_consent.sql, rule F2); no DDL names them.
 */
export const consentPurposeEnum = pgEnum("consent_purpose", CONSENT_PURPOSES);

export const consentMethodEnum = pgEnum("consent_method", CONSENT_METHODS);

export const consentSubjectTypeEnum = pgEnum(
  "consent_subject_type",
  CONSENT_SUBJECT_TYPES
);

export const consentEventActionEnum = pgEnum("consent_event_action", [
  "given",
  "withdrawn",
]);

export const consentDocument = pgTable(
  "consent_document",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    purpose: consentPurposeEnum().notNull(),
    /** 1, 2, 3 … within the purpose. */
    version: integer().notNull(),
    title: text().notNull(),
    /** Typed blocks, checked by parseConsentDocumentBody; never HTML. */
    body: jsonb().$type<ConsentDocumentBody>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    /**
     * Who published it (the seeded super admin, for seed data). No foreign
     * key: ON DELETE SET NULL would update this table, which the trigger
     * refuses, and so block deleting the user. The id stays after that
     * account is deleted.
     */
    publishedByUserId: uuid("published_by_user_id"),
    /**
     * The published revision of the policy page this version rests on
     * (#111): the privacy page for the privacy notice and messages, the
     * terms page for the terms. Null for versions published before the
     * CMS, and for seed data.
     */
    legalRevisionId: uuid("legal_revision_id").references(() => cmsRevision.id),
  },
  (table) => [
    // Also the index for "the latest version of a purpose".
    unique("consent_document_purpose_version_unique").on(
      table.purpose,
      table.version
    ),
    check("consent_document_version_positive", sql`${table.version} > 0`),
    // A CMS revision's consent documents, without scanning the table.
    index("consent_document_legal_revision_id_idx").on(table.legalRevisionId),
  ]
);

export type ConsentDocumentRow = typeof consentDocument.$inferSelect;

export const consentEvent = pgTable(
  "consent_event",
  {
    /** UUIDv7 from the clock, made in order within one millisecond. */
    id: uuid().primaryKey(),
    /** Whose consent it is: a user's own, or a child's profile (#82). */
    subjectType: consentSubjectTypeEnum("subject_type").notNull(),
    /**
     * No foreign key: it points at a different table per subject type, and
     * those tables arrive with later tickets.
     */
    subjectId: uuid("subject_id").notNull(),
    /**
     * Who gave or withdrew it: the subject themselves, or a guardian
     * (#82). Null once that account is gone.
     */
    giverUserId: uuid("giver_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    purpose: consentPurposeEnum().notNull(),
    /**
     * The competition a consent is about (#82), or null for a consent that
     * holds everywhere. Each competition keeps its own log per purpose.
     */
    competitionId: uuid("competition_id").references(() => competition.id),
    /** The version given, or the one whose consent was withdrawn. */
    documentId: uuid("document_id")
      .notNull()
      .references(() => consentDocument.id),
    action: consentEventActionEnum().notNull(),
    method: consentMethodEnum().notNull(),
    consentFormId: uuid("consent_form_id").references(() => consentForm.id),
    reviewerUserId: uuid("reviewer_user_id").references(() => user.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // One subject's log for one purpose, newest first.
    index("consent_event_subject_idx").on(
      table.subjectType,
      table.subjectId,
      table.purpose,
      table.occurredAt.desc(),
      table.id.desc()
    ),
    index("consent_event_document_id_idx").on(table.documentId),
    // A competition's consents, without scanning the log.
    index("consent_event_competition_id_idx").on(table.competitionId),
    // Deleting a user sets this to null; the index keeps that from
    // scanning the whole log.
    index("consent_event_giver_user_id_idx").on(table.giverUserId),
    index("consent_event_consent_form_id_idx").on(table.consentFormId),
    index("consent_event_reviewer_user_id_idx").on(table.reviewerUserId),
    check(
      "consent_event_signed_form_evidence",
      sql`${table.consentFormId} IS NULL OR (${table.method} = 'paper_form' AND ${table.reviewerUserId} IS NOT NULL AND ${table.giverUserId} IS NULL)`
    ),
  ]
);

export type ConsentEventRow = typeof consentEvent.$inferSelect;
