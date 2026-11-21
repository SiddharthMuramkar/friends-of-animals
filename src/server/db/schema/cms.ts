// The CMS (#111): the site's editable documents and their revisions.
//
// A document is one fixed page or block of site copy, named by its key
// (src/server/cms/domain/documents.ts). Its text lives in revisions: at
// most one open draft, which content managers edit in place, and at most
// one published revision; publishing numbers the draft and supersedes the
// one before. Published and superseded revisions never change again: a
// trigger refuses any other UPDATE or DELETE of them
// (drizzle/*_111_cms_revision_guard.sql).
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
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

import { CMS_REVISION_STATUSES } from "../../cms/domain/revisions";

export const cmsRevisionStatusEnum = pgEnum(
  "cms_revision_status",
  CMS_REVISION_STATUSES
);

export const cmsDocument = pgTable("cms_document", {
  /** UUIDv7 from the clock. */
  id: uuid().primaryKey(),
  /** One of CMS_DOCUMENT_KEYS, e.g. `legal_privacy`. */
  key: text().notNull().unique(),
  /** The body schema its revisions follow, e.g. `legal`. */
  kind: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export type CmsDocumentRow = typeof cmsDocument.$inferSelect;

export const cmsRevision = pgTable(
  "cms_revision",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => cmsDocument.id),
    /** 1, 2, 3 … within the document, given at publish; null for a draft. */
    version: integer(),
    /** The kind's typed body, sanitised before it is stored; never HTML. */
    body: jsonb().notNull(),
    status: cmsRevisionStatusEnum().notNull(),
    /**
     * Who started the draft and who published it; null for seed data. No
     * foreign keys: ON DELETE SET NULL would update published revisions,
     * which the trigger refuses, and so block deleting the user.
     */
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    publishedByUserId: uuid("published_by_user_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    unique("cms_revision_document_version_unique").on(
      table.documentId,
      table.version
    ),
    uniqueIndex("cms_revision_one_draft")
      .on(table.documentId)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex("cms_revision_one_published")
      .on(table.documentId)
      .where(sql`${table.status} = 'published'`),
    // A draft has no number and no publish date; every other revision has both.
    check(
      "cms_revision_numbered_once_published",
      sql`(${table.status} = 'draft') = (${table.version} IS NULL AND ${table.publishedAt} IS NULL)`
    ),
    check(
      "cms_revision_version_positive",
      sql`${table.version} IS NULL OR ${table.version} > 0`
    ),
  ]
);

export type CmsRevisionRow = typeof cmsRevision.$inferSelect;
