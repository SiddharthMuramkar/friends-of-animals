import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { auctionLot, physicalArtwork } from "../../db/schema";
import { ACTIVE_LOT_STATUSES } from "./domain/lot-status";

/** Call while holding a competition lock; new lot creation holds its share
 * lock. Sold originals remain reserved in custody, but do not prevent
 * future competitions' consent-policy changes. */
export async function hasUnsettledAuctionLots(
  db: AppDb,
  competitionId: string
) {
  const [row] = await db
    .select({ id: auctionLot.id })
    .from(auctionLot)
    .innerJoin(physicalArtwork, eq(physicalArtwork.id, auctionLot.artworkId))
    .where(
      and(
        eq(physicalArtwork.competitionId, competitionId),
        inArray(
          auctionLot.status,
          ACTIVE_LOT_STATUSES.filter((s) => s !== "sold")
        )
      )
    )
    .limit(1);
  return !!row;
}
