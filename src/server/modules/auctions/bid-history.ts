import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { auctionBid, type AuctionLotRow } from "../../db/schema";

/** Read the current highest accepted bid. Writers must first hold the lot's
 * row lock, so no other bid can sneak ahead. Erased bids still establish
 * the public price; erasure never lowers a competitive price. */
export async function highestBid(db: AppDb, lotId: string) {
  const [row] = await db
    .select()
    .from(auctionBid)
    .where(eq(auctionBid.lotId, lotId))
    .orderBy(desc(auctionBid.amountPaise))
    .limit(1);
  return row ?? null;
}

/** The winning payable bid of a closed lot. Internal handoff to #133:
 * callers hold the lot's lock, recheck consent, and must not expose the
 * winner's account id in public or unrelated creator reads. A bid whose
 * account was erased cannot be paid. The next surviving bid may win if it
 * meets reserve. No payment request happens in #132. */
export async function closedWinningBid(db: AppDb, lot: AuctionLotRow) {
  if (lot.status !== "closed") return null;
  const [row] = await db
    .select()
    .from(auctionBid)
    .where(
      and(
        eq(auctionBid.lotId, lot.id),
        gte(auctionBid.amountPaise, lot.reservePricePaise),
        isNotNull(auctionBid.bidderUserId)
      )
    )
    .orderBy(desc(auctionBid.amountPaise))
    .limit(1);
  return row?.bidderUserId ? { ...row, bidderUserId: row.bidderUserId } : null;
}
