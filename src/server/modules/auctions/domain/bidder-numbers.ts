// How a lot's bids are shown in public: bidders are numbered 1, 2, 3 … in
// the order of their first bid on that lot, so people can follow the
// bidding without anyone's name or account being exposed. Numbers are per
// lot; the same person has unrelated numbers on two lots. A signed-in
// bidder also learns their own number and whether they lead.
//
// Pure. Bids are ordered by time, then by id (UUIDv7, so time-ordered too)
// to break ties the same way every time.

export type StoredBid = {
  id: string;
  bidderUserId: string;
  amountPaise: bigint;
  placedAt: Date;
};

/** A bid as anyone may see it: no ids, no names. */
export type PublicBid = {
  bidderNumber: number;
  amountPaise: bigint;
  placedAt: Date;
};

function oldestFirst(bids: readonly StoredBid[]): StoredBid[] {
  return [...bids].sort(
    (a, b) =>
      a.placedAt.getTime() - b.placedAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function numberBidders(ordered: readonly StoredBid[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const bid of ordered) {
    if (!numbers.has(bid.bidderUserId)) {
      numbers.set(bid.bidderUserId, numbers.size + 1);
    }
  }
  return numbers;
}

/** The lot's bids, newest first, each with its bidder's number. */
export function publicBidHistory(bids: readonly StoredBid[]): PublicBid[] {
  const ordered = oldestFirst(bids);
  const numbers = numberBidders(ordered);
  return ordered.reverse().map((bid) => ({
    bidderNumber: numbers.get(bid.bidderUserId)!,
    amountPaise: bid.amountPaise,
    placedAt: bid.placedAt,
  }));
}

/** The viewer's own number on this lot and whether they hold the highest bid. */
export function viewerStanding(
  bids: readonly StoredBid[],
  viewerUserId: string | null
): { bidderNumber: number; leading: boolean } | null {
  if (viewerUserId === null) return null;
  const ordered = oldestFirst(bids);
  const bidderNumber = numberBidders(ordered).get(viewerUserId);
  if (bidderNumber === undefined) return null;
  const highest = ordered.reduce((best, bid) =>
    bid.amountPaise > best.amountPaise ? bid : best
  );
  return { bidderNumber, leading: highest.bidderUserId === viewerUserId };
}
