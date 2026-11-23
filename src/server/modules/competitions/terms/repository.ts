// The competition terms' queries. Every function takes the database or the
// open transaction to run in.
//
// Loads under plain Node: relative imports only.

import { asc, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../../db/app-db";
import {
  competition,
  competitionAwardScheme,
  competitionConsentDocument,
  competitionFee,
  consentDocument,
} from "../../../db/schema";
import type { StoredRoundAwards } from "../domain/award-schemes";
import {
  ATTACHABLE_PURPOSES,
  isAttachablePurpose,
  type AttachablePurpose,
} from "../domain/consent-attachments";
import type { Fees } from "../domain/fees";
import type { Participation } from "../domain/vocabulary";

/** What the terms need to know about the competition itself. */
export type CompetitionForTerms = {
  id: string;
  code: string;
  slug: string;
  name: string;
  status: string;
  /** Null in a draft until the manager chooses it. */
  participation: Participation | null;
  publicDisplay: boolean;
  auctionPermitted: boolean;
};

const competitionColumns = {
  id: competition.id,
  code: competition.code,
  slug: competition.slug,
  name: competition.name,
  status: competition.status,
  participation: competition.participation,
  publicDisplay: competition.publicDisplay,
  auctionPermitted: competition.auctionPermitted,
};

/** The competition, or null. */
export async function findCompetition(
  db: AppDb,
  competitionId: string
): Promise<CompetitionForTerms | null> {
  const [row] = await db
    .select(competitionColumns)
    .from(competition)
    .where(eq(competition.id, competitionId));
  return row ?? null;
}

/**
 * The competition, locked until the transaction ends, or null. Changes to
 * one competition's terms queue behind each other, and behind a status
 * change (#71), so a fee can't change as registration opens.
 */
export async function lockCompetition(
  tx: AppDb,
  competitionId: string
): Promise<CompetitionForTerms | null> {
  const [row] = await tx
    .select(competitionColumns)
    .from(competition)
    .where(eq(competition.id, competitionId))
    .for("no key update");
  return row ?? null;
}

/** The stored fee per route, in paise. */
export async function storedFees(
  db: AppDb,
  competitionId: string
): Promise<Fees> {
  const rows = await db
    .select({ route: competitionFee.route, amount: competitionFee.amountMinor })
    .from(competitionFee)
    .where(eq(competitionFee.competitionId, competitionId));
  return Object.fromEntries(rows.map((row) => [row.route, row.amount]));
}

/** The rounds whose scheme or prizes were set. */
export async function storedAwards(
  db: AppDb,
  competitionId: string
): Promise<StoredRoundAwards[]> {
  const rows = await db
    .select({
      roundKey: competitionAwardScheme.round,
      scheme: competitionAwardScheme.scheme,
      prizes: competitionAwardScheme.prizes,
    })
    .from(competitionAwardScheme)
    .where(eq(competitionAwardScheme.competitionId, competitionId))
    .orderBy(asc(competitionAwardScheme.round));
  return rows;
}

/** A consent document version, as the terms show it. */
export type DocumentRef = {
  id: string;
  version: number;
  title: string;
};

export type PinnedDocument = DocumentRef & { purpose: AttachablePurpose };

/** The pinned version per purpose, in `ATTACHABLE_PURPOSES` order. */
export async function pinnedDocuments(
  db: AppDb,
  competitionId: string
): Promise<PinnedDocument[]> {
  const rows = await db
    .select({
      purpose: competitionConsentDocument.purpose,
      id: consentDocument.id,
      version: consentDocument.version,
      title: consentDocument.title,
    })
    .from(competitionConsentDocument)
    .innerJoin(
      consentDocument,
      eq(consentDocument.id, competitionConsentDocument.consentDocumentId)
    )
    .where(eq(competitionConsentDocument.competitionId, competitionId));
  return ATTACHABLE_PURPOSES.flatMap((purpose) => {
    const row = rows.find((candidate) => candidate.purpose === purpose);
    return row ? [{ ...row, purpose }] : [];
  });
}

/** The pinned version of one purpose, or null. */
export async function pinnedDocument(
  db: AppDb,
  competitionId: string,
  purpose: AttachablePurpose
): Promise<PinnedDocument | null> {
  const pinned = await pinnedDocuments(db, competitionId);
  return pinned.find((document) => document.purpose === purpose) ?? null;
}

/** The latest published version of each attachable purpose that has one. */
export async function latestDocuments(
  db: AppDb
): Promise<Map<AttachablePurpose, DocumentRef>> {
  const rows = await db
    .selectDistinctOn([consentDocument.purpose], {
      purpose: consentDocument.purpose,
      id: consentDocument.id,
      version: consentDocument.version,
      title: consentDocument.title,
    })
    .from(consentDocument)
    .where(inArray(consentDocument.purpose, [...ATTACHABLE_PURPOSES]))
    .orderBy(consentDocument.purpose, desc(consentDocument.version));
  const latest = new Map<AttachablePurpose, DocumentRef>();
  for (const { purpose, ...document } of rows) {
    if (isAttachablePurpose(purpose)) latest.set(purpose, document);
  }
  return latest;
}
