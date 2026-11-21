// The consent module's queries. Every function takes the database or the
// open transaction to run in.
//
// Loads under plain Node: relative imports only.

import { desc, eq } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import { consentDocument, user } from "../db/schema";
import type { ConsentDocumentBody } from "./domain/document-body";
import type { ConsentPurpose } from "./domain/purposes";

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
