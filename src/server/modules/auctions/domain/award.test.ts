import { describe, expect, it } from "vitest";

import { decideAward, type BidFact, type PriorOffer } from "./award";

const at = (minute: number) => new Date(Date.UTC(2027, 0, 15, 4, minute, 0));

function bid(
  bidId: string,
  bidderUserId: string,
  rupees: number,
  minute: number
): BidFact {
  return {
    bidId,
    bidderUserId,
    amountPaise: BigInt(rupees) * 100n,
    placedAt: at(minute),
  };
}

// Reserve ₹1,500. Asha leads at ₹2,200; Bina's best is ₹2,000; Chetan's
// best is ₹1,600; Dev never reached the reserve.
const BIDS: BidFact[] = [
  bid("b1", "dev", 1_000, 1),
  bid("b2", "asha", 1_200, 2),
  bid("b3", "bina", 1_400, 3),
  bid("b4", "chetan", 1_600, 4),
  bid("b5", "asha", 1_800, 5),
  bid("b6", "bina", 2_000, 6),
  bid("b7", "asha", 2_200, 7),
];
const RESERVE = 150_000n;

const expired = (bidderUserId: string): PriorOffer => ({
  bidderUserId,
  status: "expired",
});

describe("decideAward at close", () => {
  it("offers the lot to the highest bidder at their bid", () => {
    expect(
      decideAward({
        bids: BIDS,
        reservePaise: RESERVE,
        priorOffers: [],
        maxOffers: 3,
      })
    ).toEqual({
      kind: "offer",
      bidId: "b7",
      bidderUserId: "asha",
      amountPaise: 220_000n,
    });
  });

  it("offers a top bid exactly at the reserve", () => {
    expect(
      decideAward({
        bids: [bid("b1", "asha", 1_500, 1)],
        reservePaise: RESERVE,
        priorOffers: [],
        maxOffers: 3,
      })
    ).toEqual({
      kind: "offer",
      bidId: "b1",
      bidderUserId: "asha",
      amountPaise: 150_000n,
    });
  });

  it("settles a lot with no bids as unsold", () => {
    expect(
      decideAward({
        bids: [],
        reservePaise: RESERVE,
        priorOffers: [],
        maxOffers: 3,
      })
    ).toEqual({ kind: "unsold", reason: "no_bids" });
  });

  it("settles a lot whose top bid is under the reserve as unsold", () => {
    expect(
      decideAward({
        bids: [bid("b1", "dev", 1_000, 1), bid("b2", "asha", 1_499, 2)],
        reservePaise: RESERVE,
        priorOffers: [],
        maxOffers: 3,
      })
    ).toEqual({ kind: "unsold", reason: "reserve_not_met" });
  });
});

describe("decideAward after an offer expired", () => {
  it("passes the lot to the next bidder at their own best bid, skipping the defaulter's other bids", () => {
    expect(
      decideAward({
        bids: BIDS,
        reservePaise: RESERVE,
        priorOffers: [expired("asha")],
        maxOffers: 3,
      })
    ).toEqual({
      kind: "offer",
      bidId: "b6",
      bidderUserId: "bina",
      amountPaise: 200_000n,
    });
  });

  it("goes down the bidders in order, never back to one who defaulted", () => {
    expect(
      decideAward({
        bids: BIDS,
        reservePaise: RESERVE,
        priorOffers: [expired("asha"), expired("bina")],
        maxOffers: 3,
      })
    ).toEqual({
      kind: "offer",
      bidId: "b4",
      bidderUserId: "chetan",
      amountPaise: 160_000n,
    });
  });

  it("relists when no bidder left reached the reserve", () => {
    expect(
      decideAward({
        bids: BIDS,
        reservePaise: RESERVE,
        priorOffers: [expired("asha"), expired("bina"), expired("chetan")],
        maxOffers: 5,
      })
    ).toEqual({ kind: "relist", reason: "no_eligible_bidder" });
  });

  it("relists once the configured number of offers has been made", () => {
    expect(
      decideAward({
        bids: BIDS,
        reservePaise: RESERVE,
        priorOffers: [expired("asha"), expired("bina")],
        maxOffers: 2,
      })
    ).toEqual({ kind: "relist", reason: "offer_limit_reached" });
  });

  it("breaks a tie between two bidders' best bids by who bid first", () => {
    expect(
      decideAward({
        bids: [
          bid("b1", "asha", 3_000, 9),
          bid("b2", "bina", 2_000, 5),
          bid("b3", "chetan", 2_000, 4),
        ],
        reservePaise: RESERVE,
        priorOffers: [expired("asha")],
        maxOffers: 3,
      })
    ).toEqual({
      kind: "offer",
      bidId: "b3",
      bidderUserId: "chetan",
      amountPaise: 200_000n,
    });
  });

  it("does nothing while an offer is still open or already paid", () => {
    for (const status of ["open", "paid"] as const) {
      expect(
        decideAward({
          bids: BIDS,
          reservePaise: RESERVE,
          priorOffers: [{ bidderUserId: "asha", status }],
          maxOffers: 3,
        })
      ).toEqual({ kind: "keep", reason: "offer_outstanding" });
    }
  });

  it("refuses an offer limit below one", () => {
    expect(() =>
      decideAward({
        bids: BIDS,
        reservePaise: RESERVE,
        priorOffers: [],
        maxOffers: 0,
      })
    ).toThrow(RangeError);
  });
});
