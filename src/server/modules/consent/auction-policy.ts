import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionConsentDocument,
  consentDocument,
} from "../../db/schema";
import { auctionShareInDocument } from "./domain/auction-proceeds";

/** Resolve the competition's attached, immutable auction consent terms.
 * A newer global version is irrelevant until explicitly pinned here. */
export async function auctionPolicyDocument(db: AppDb, competitionId: string) {
  const [row] = await db
    .select({
      document: consentDocument,
      share: competition.auctionCreatorShareBps,
      permitted: competition.auctionPermitted,
    })
    .from(competition)
    .innerJoin(
      competitionConsentDocument,
      and(
        eq(competition.id, competitionConsentDocument.competitionId),
        eq(competitionConsentDocument.purpose, "auction")
      )
    )
    .innerJoin(
      consentDocument,
      and(
        eq(consentDocument.id, competitionConsentDocument.consentDocumentId),
        eq(consentDocument.purpose, "auction")
      )
    )
    .where(eq(competition.id, competitionId));
  if (!row) return null;
  const acknowledgedShare = auctionShareInDocument(row.document.body);
  return {
    ...row,
    acknowledgedShare,
    compatible:
      row.permitted &&
      acknowledgedShare !== null &&
      acknowledgedShare === row.share,
  };
}
