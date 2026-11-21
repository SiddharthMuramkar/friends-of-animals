// The consent module's queries. Every function takes the database or the
// open transaction to run in.
//
// Loads under plain Node: relative imports only.

import { and, desc, eq } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import { consentDocument, consentEvent, user } from "../db/schema";
import type { ConsentDocumentBody } from "./domain/document-body";
import type { ConsentPurpose, ConsentSubjectType } from "./domain/purposes";

export type DocumentRow = {
  id: string;
  purpose: ConsentPurpose;
  version: number;
  title: string;
  body: ConsentDocumentBody;
  publishedAt: Date;
};

const documentColumns = {
  id: consentDocument.id,
  purpose: consentDocument.purpose,
  version: consentDocument.version,
  title: consentDocument.title,
  body: consentDocument.body,
  publishedAt: consentDocument.publishedAt,
};

/** The latest published version of a purpose's document, if any. */
export async function latestDocument(
  db: AppDb,
  purpose: ConsentPurpose
): Promise<DocumentRow | null> {
  const [row] = await db
    .select(documentColumns)
    .from(consentDocument)
    .where(eq(consentDocument.purpose, purpose))
    .orderBy(desc(consentDocument.version))
    .limit(1);
  return row ?? null;
}

/** Every version of a purpose's document, newest first, with its publisher. */
export async function documentVersions(db: AppDb, purpose: ConsentPurpose) {
  return db
    .select({
      ...documentColumns,
      publisherId: user.id,
      publisherName: user.name,
    })
    .from(consentDocument)
    .leftJoin(user, eq(user.id, consentDocument.publishedByUserId))
    .where(eq(consentDocument.purpose, purpose))
    .orderBy(desc(consentDocument.version));
}

/** Whose consent an event is about. */
export type ConsentSubject = { type: ConsentSubjectType; id: string };

/** One subject's events for one purpose, newest first, with versions. */
export async function subjectEvents(
  db: AppDb,
  subject: ConsentSubject,
  purpose: ConsentPurpose
) {
  return db
    .select({
      id: consentEvent.id,
      action: consentEvent.action,
      documentId: consentEvent.documentId,
      documentVersion: consentDocument.version,
      method: consentEvent.method,
      occurredAt: consentEvent.occurredAt,
    })
    .from(consentEvent)
    .innerJoin(consentDocument, eq(consentDocument.id, consentEvent.documentId))
    .where(
      and(
        eq(consentEvent.subjectType, subject.type),
        eq(consentEvent.subjectId, subject.id),
        eq(consentEvent.purpose, purpose)
      )
    )
    .orderBy(desc(consentEvent.occurredAt), desc(consentEvent.id));
}

/**
 * Locks a user subject's row until the transaction ends, so two changes to
 * one person's consent queue and each decides on the latest state.
 */
export async function lockUserSubject(db: AppDb, userId: string) {
  await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("no key update");
}
