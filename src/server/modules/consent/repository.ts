// The consent module's queries. Every function takes the database or the
// open transaction to run in.
//
// Loads under plain Node: relative imports only.

import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  consentDocument,
  consentEvent,
  participantProfile,
  user,
} from "../../db/schema";
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

/**
 * Which competition's log: a child's consent for one competition, or one
 * that holds everywhere (null). Own publication consent is scoped to its
 * competition too. Callers may omit the filter to read across scopes.
 */
function competitionFilter(competitionId: string | null | undefined): SQL[] {
  if (competitionId === undefined) return [];
  return [
    competitionId === null
      ? isNull(consentEvent.competitionId)
      : eq(consentEvent.competitionId, competitionId),
  ];
}

/**
 * One subject's events for one purpose, newest first, with versions; for
 * a child's, those of one competition (or of none, for communications).
 */
export async function subjectEvents(
  db: AppDb,
  subject: ConsentSubject,
  purpose: ConsentPurpose,
  competitionId?: string | null,
  giverUserId?: string
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
        eq(consentEvent.purpose, purpose),
        giverUserId === undefined
          ? undefined
          : eq(consentEvent.giverUserId, giverUserId),
        ...competitionFilter(competitionId)
      )
    )
    .orderBy(
      ...(subject.type === "participant_profile"
        ? [desc(consentEvent.id)]
        : [desc(consentEvent.occurredAt), desc(consentEvent.id)])
    );
}

/** The last append across all purposes and competitions for a profile. */
export async function latestProfileEventId(tx: AppDb, profileId: string) {
  const [last] = await tx
    .select({ id: consentEvent.id })
    .from(consentEvent)
    .where(
      and(
        eq(consentEvent.subjectType, "participant_profile"),
        eq(consentEvent.subjectId, profileId)
      )
    )
    .orderBy(desc(consentEvent.id))
    .limit(1);
  return last?.id;
}

/**
 * Locks a child's profile row until the transaction ends (#82), so two
 * changes to one child's consents, and a registration of the child, queue
 * and each decides on the latest state.
 */
export async function lockProfileSubject(db: AppDb, profileId: string) {
  await db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(eq(participantProfile.id, profileId))
    .for("no key update");
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
