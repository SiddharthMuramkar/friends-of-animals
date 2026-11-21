// The CMS module's queries (#111). Every function takes the database or
// the open transaction to run in.
//
// Loads under plain Node: relative imports only.

import { aliasedTable, and, desc, eq, max, sql } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import { cmsDocument, cmsRevision, user } from "../db/schema";
import { uuidv7 } from "../ids";
import { cmsDocumentKind, type CmsDocumentKey } from "./domain/documents";
import type { CmsRevisionStatus, RevisionRef } from "./domain/revisions";

/** The document row for `key`, made on first use: no seed is needed. */
export async function ensureDocument(
  db: AppDb,
  key: CmsDocumentKey,
  now: Date
): Promise<{ id: string }> {
  await db
    .insert(cmsDocument)
    .values({
      id: uuidv7(now),
      key,
      kind: cmsDocumentKind(key),
      createdAt: now,
    })
    .onConflictDoNothing({ target: cmsDocument.key });
  const [row] = await db
    .select({ id: cmsDocument.id })
    .from(cmsDocument)
    .where(eq(cmsDocument.key, key));
  if (!row) throw new Error(`Could not make the ${key} document`);
  return row;
}

/** A document's revision in `status`, locked for this transaction. */
export async function revisionInStatus(
  tx: AppDb,
  documentId: string,
  status: Exclude<CmsRevisionStatus, "superseded">
): Promise<RevisionRef | null> {
  const [row] = await tx
    .select({
      id: cmsRevision.id,
      status: cmsRevision.status,
      version: cmsRevision.version,
    })
    .from(cmsRevision)
    .where(
      and(
        eq(cmsRevision.documentId, documentId),
        eq(cmsRevision.status, status)
      )
    )
    .for("update");
  return row ?? null;
}

/** A revision and its document's key, locked for this transaction. */
export async function lockRevision(tx: AppDb, revisionId: string) {
  const [row] = await tx
    .select({
      id: cmsRevision.id,
      status: cmsRevision.status,
      version: cmsRevision.version,
      body: cmsRevision.body,
      documentId: cmsRevision.documentId,
      key: cmsDocument.key,
    })
    .from(cmsRevision)
    .innerJoin(cmsDocument, eq(cmsDocument.id, cmsRevision.documentId))
    .where(eq(cmsRevision.id, revisionId))
    .for("update", { of: cmsRevision });
  return row ?? null;
}

/**
 * Locks the document row, so two publishes of one document take turns
 * and number their versions one after the other.
 */
export async function lockDocument(tx: AppDb, documentId: string) {
  await tx
    .select({ id: cmsDocument.id })
    .from(cmsDocument)
    .where(eq(cmsDocument.id, documentId))
    .for("update");
}

/** The highest version a document has ever published, or 0. */
export async function maxVersion(tx: AppDb, documentId: string) {
  const [row] = await tx
    .select({ max: max(cmsRevision.version) })
    .from(cmsRevision)
    .where(eq(cmsRevision.documentId, documentId));
  return row?.max ?? 0;
}

/** Per document key: its published version and whether a draft is open. */
export async function documentStates(db: AppDb) {
  return db
    .select({
      key: cmsDocument.key,
      status: cmsRevision.status,
      version: cmsRevision.version,
      publishedAt: cmsRevision.publishedAt,
    })
    .from(cmsRevision)
    .innerJoin(cmsDocument, eq(cmsDocument.id, cmsRevision.documentId))
    .where(sql`${cmsRevision.status} IN ('draft', 'published')`);
}

const creator = aliasedTable(user, "creator");
const publisher = aliasedTable(user, "publisher");

/** Every revision of a document, newest first, with who made it. */
export async function revisionsOf(db: AppDb, key: CmsDocumentKey) {
  return db
    .select({
      id: cmsRevision.id,
      status: cmsRevision.status,
      version: cmsRevision.version,
      createdAt: cmsRevision.createdAt,
      updatedAt: cmsRevision.updatedAt,
      publishedAt: cmsRevision.publishedAt,
      creatorId: creator.id,
      creatorName: creator.name,
      publisherId: publisher.id,
      publisherName: publisher.name,
    })
    .from(cmsRevision)
    .innerJoin(cmsDocument, eq(cmsDocument.id, cmsRevision.documentId))
    .leftJoin(creator, eq(creator.id, cmsRevision.createdByUserId))
    .leftJoin(publisher, eq(publisher.id, cmsRevision.publishedByUserId))
    .where(eq(cmsDocument.key, key))
    .orderBy(desc(cmsRevision.createdAt), desc(cmsRevision.id));
}

/** A document's draft or published revision with its body, if any. */
export async function revisionBodyOf(
  db: AppDb,
  key: CmsDocumentKey,
  status: Exclude<CmsRevisionStatus, "superseded">
) {
  const [row] = await db
    .select({
      id: cmsRevision.id,
      version: cmsRevision.version,
      body: cmsRevision.body,
      updatedAt: cmsRevision.updatedAt,
      publishedAt: cmsRevision.publishedAt,
    })
    .from(cmsRevision)
    .innerJoin(cmsDocument, eq(cmsDocument.id, cmsRevision.documentId))
    .where(and(eq(cmsDocument.key, key), eq(cmsRevision.status, status)));
  return row ?? null;
}

/** The id of a document's published revision, or null. */
export async function publishedRevisionId(
  db: AppDb,
  key: CmsDocumentKey
): Promise<string | null> {
  return (await revisionBodyOf(db, key, "published"))?.id ?? null;
}
