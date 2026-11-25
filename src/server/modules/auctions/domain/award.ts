// Who a lot goes to once bidding ends (#133). At close, the highest bidder
// gets a payment offer if their bid reached the reserve; otherwise the lot is
// unsold. When an offer expires unpaid, the next bidder gets one: bidders
// are ranked by their own best bid (ties go to whoever bid first), anyone
// who already had an offer on the lot is skipped, and each pays what they
// bid. When nobody left reached the reserve, or the configured number of
// offers has been made, the lot is relisted: it ends, and its artwork goes
// back to the status it had before listing so a manager can list it again.
//
// The same decision runs at close and after every expiry, against the lot
// row the use case has locked, so a repeated or stale job decides nothing
// new.
//
// Pure: money is bigint paise (#55).

import type { OfferStatus } from "./payment-offer";

/** One `auction_bid` row, as the award reads it. */
export type BidFact = {
  bidId: string;
  bidderUserId: string;
  amountPaise: bigint;
  placedAt: Date;
};

/** An offer already made on this lot. */
export type PriorOffer = { bidderUserId: string; status: OfferStatus };

export type AwardDecision =
  | { kind: "offer"; bidId: string; bidderUserId: string; amountPaise: bigint }
  | { kind: "unsold"; reason: "no_bids" | "reserve_not_met" }
  | { kind: "relist"; reason: "no_eligible_bidder" | "offer_limit_reached" }
  | { kind: "keep"; reason: "offer_outstanding" };

/** Each bidder's best bid: the highest, and the earliest of equal ones. */
function bestBidPerBidder(bids: readonly BidFact[]): BidFact[] {
  const best = new Map<string, BidFact>();
  for (const bid of bids) {
    const current = best.get(bid.bidderUserId);
    if (!current || ranksBefore(bid, current)) best.set(bid.bidderUserId, bid);
  }
  return [...best.values()];
}

/** Higher amount first; for equal amounts, the earlier bid. */
function ranksBefore(a: BidFact, b: BidFact): boolean {
  if (a.amountPaise !== b.amountPaise) return a.amountPaise > b.amountPaise;
  if (a.placedAt.getTime() !== b.placedAt.getTime()) {
    return a.placedAt.getTime() < b.placedAt.getTime();
  }
  return a.bidId < b.bidId;
}

/** Who the lot goes to next, or how it ends. */
export function decideAward(input: {
  bids: readonly BidFact[];
  reservePaise: bigint;
  priorOffers: readonly PriorOffer[];
  /** The setting `auctions.maxPaymentOffers`. */
  maxOffers: number;
}): AwardDecision {
  if (!Number.isInteger(input.maxOffers) || input.maxOffers < 1) {
    throw new RangeError("At least one payment offer must be allowed");
  }
  const { priorOffers } = input;
  if (
    priorOffers.some(
      (offer) => offer.status === "open" || offer.status === "paid"
    )
  ) {
    return { kind: "keep", reason: "offer_outstanding" };
  }
  const isFallback = priorOffers.length > 0;
  if (isFallback && priorOffers.length >= input.maxOffers) {
    return { kind: "relist", reason: "offer_limit_reached" };
  }
  const offered = new Set(priorOffers.map((offer) => offer.bidderUserId));
  const [next] = bestBidPerBidder(input.bids)
    .filter((bid) => bid.amountPaise >= input.reservePaise)
    .filter((bid) => !offered.has(bid.bidderUserId))
    .sort((a, b) => (ranksBefore(a, b) ? -1 : 1));
  if (next) {
    return {
      kind: "offer",
      bidId: next.bidId,
      bidderUserId: next.bidderUserId,
      amountPaise: next.amountPaise,
    };
  }
  if (isFallback) return { kind: "relist", reason: "no_eligible_bidder" };
  return {
    kind: "unsold",
    reason: input.bids.length === 0 ? "no_bids" : "reserve_not_met",
  };
}
