import type { AppDb } from "../../db/app-db";
import { pinnedDocuments } from "../competitions/terms/repository";
import {
  isPublicationPurpose,
  offeredPurposes,
  type PublicationPurpose,
} from "../consent/domain/guardian-purposes";

export type OfferedPublicUse = {
  purpose: PublicationPurpose;
  documentId: string;
  version: number;
  title: string;
};

/** Only independent publication choices belong on a school consent link. */
export async function offeredPublicUses(
  db: AppDb,
  competition: { id: string; publicDisplay: boolean; auctionPermitted: boolean }
): Promise<OfferedPublicUse[]> {
  const documents = await pinnedDocuments(db, competition.id);
  const offered = offeredPurposes({
    publicDisplayAllowed: competition.publicDisplay,
    auctionAllowed: competition.auctionPermitted,
    attached: Object.fromEntries(
      documents.map((document) => [document.purpose, document])
    ),
  });
  return offered.flatMap(({ purpose, document }) => {
    if (!isPublicationPurpose(purpose)) return [];
    const pinned = documents.find(({ id }) => id === document.id);
    return pinned
      ? [
          {
            purpose,
            documentId: pinned.id,
            version: pinned.version,
            title: pinned.title,
          },
        ]
      : [];
  });
}
