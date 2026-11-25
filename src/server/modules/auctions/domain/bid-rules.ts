// Whether a bid on a lot is accepted, and what the lot looks like after it.
// A bid is accepted only while the lot is open (status `open`, on or after
// `opensAt`, before `closesAt`), and only at the base price or more for the
// first bid, or at the current highest plus the minimum increment or more
// after that. An accepted bid in the anti-sniping window extends the close.
//
// The use case decides every bid against the lot row it has locked, and
// writes `next` back, so two bids placed at the same moment are decided one
// after the other and can't both win.
//
// Pure: money is bigint paise (#55), times come from the injected clock.

import { MAX_PAISE } from "../../competitions/domain/fees";
import { closeAfterBid } from "./anti-sniping";

/** What the bidding rules read from an `auction_lot` row. */
export type LotSnapshot = {
  /** An `auction_lot_status` value (#131); only `open` takes bids. */
  status: string;
  opensAt: Date;
  closesAt: Date;
  basePricePaise: bigint;
  currentBidPaise: bigint | null;
  currentBidderUserId: string | null;
};

/** The settings `auctions.minIncrementPaise` and `auctions.antiSnipingWindowMinutes`. */
export type BidRules = {
  minIncrementPaise: bigint;
  antiSnipingWindowMinutes: number;
};

export type BidRefusal =
  | { ok: false; reason: "invalid_amount" | "lot_not_open" | "lot_closed" }
  | {
      ok: false;
      reason: "bid_below_base" | "bid_too_low";
      minimumPaise: bigint;
    };

export type BidAcceptance = {
  ok: true;
  /** The lot after the bid: write these fields back to the row. */
  next: LotSnapshot;
  /** The previous leader, who gets an outbid message; null on a first bid or a self-raise. */
  outbidUserId: string | null;
  /** True when the bid moved the close back (anti-sniping). */
  extended: boolean;
};

export type BidDecision = BidAcceptance | BidRefusal;

/** Statuses a lot has before bidding starts; every other non-open one has ended. */
const NOT_YET_OPEN = new Set(["draft", "scheduled"]);

/** The least a bid on `lot` must be to be accepted. */
export function minimumNextBid(
  lot: Pick<LotSnapshot, "basePricePaise" | "currentBidPaise">,
  rules: Pick<BidRules, "minIncrementPaise">
): bigint {
  return lot.currentBidPaise === null
    ? lot.basePricePaise
    : lot.currentBidPaise + rules.minIncrementPaise;
}

function openRefusal(lot: LotSnapshot, placedAt: Date): BidRefusal | null {
  if (lot.status !== "open") {
    return NOT_YET_OPEN.has(lot.status)
      ? { ok: false, reason: "lot_not_open" }
      : { ok: false, reason: "lot_closed" };
  }
  if (placedAt.getTime() < lot.opensAt.getTime()) {
    return { ok: false, reason: "lot_not_open" };
  }
  if (placedAt.getTime() >= lot.closesAt.getTime()) {
    return { ok: false, reason: "lot_closed" };
  }
  return null;
}

/**
 * Decides one bid against the lot as it stands. The lot is checked before
 * the amount, so a bid on a closed lot says the lot is closed.
 */
export function decideBid(input: {
  lot: LotSnapshot;
  bidderUserId: string;
  amountPaise: bigint;
  placedAt: Date;
  rules: BidRules;
}): BidDecision {
  const { lot, bidderUserId, amountPaise, placedAt, rules } = input;
  if (rules.minIncrementPaise <= 0n) {
    throw new RangeError(
      `The minimum increment must be positive; got ${rules.minIncrementPaise} paise`
    );
  }
  const notOpen = openRefusal(lot, placedAt);
  if (notOpen) return notOpen;
  if (amountPaise <= 0n || amountPaise > MAX_PAISE)
    return { ok: false, reason: "invalid_amount" };

  const minimumPaise = minimumNextBid(lot, rules);
  if (amountPaise < minimumPaise) {
    return {
      ok: false,
      reason: lot.currentBidPaise === null ? "bid_below_base" : "bid_too_low",
      minimumPaise,
    };
  }

  const close = closeAfterBid({
    closesAt: lot.closesAt,
    placedAt,
    windowMinutes: rules.antiSnipingWindowMinutes,
  });
  const previous = lot.currentBidderUserId;
  return {
    ok: true,
    next: {
      ...lot,
      currentBidPaise: amountPaise,
      currentBidderUserId: bidderUserId,
      closesAt: close.closesAt,
    },
    outbidUserId:
      previous !== null && previous !== bidderUserId ? previous : null,
    extended: close.extended,
  };
}
