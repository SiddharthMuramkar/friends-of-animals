import { describe, expect, it } from "vitest";

import { publicBidHistory, viewerStanding } from "./bidder-numbers";

const ASHA = "01938a00-0000-7000-8000-000000000101";
const RAVI = "01938a00-0000-7000-8000-000000000102";
const MEERA = "01938a00-0000-7000-8000-000000000103";

/** Stored bids, deliberately out of order. */
const BIDS = [
  {
    id: "0194b5f0-0003-7000-8000-000000000003",
    bidderUserId: ASHA,
    amountPaise: 120_000n,
    placedAt: new Date("2027-02-01T09:00:00.000Z"),
  },
  {
    id: "0194b5f0-0001-7000-8000-000000000001",
    bidderUserId: RAVI,
    amountPaise: 100_000n,
    placedAt: new Date("2027-02-01T08:00:00.000Z"),
  },
  {
    id: "0194b5f0-0002-7000-8000-000000000002",
    bidderUserId: ASHA,
    amountPaise: 110_000n,
    placedAt: new Date("2027-02-01T08:30:00.000Z"),
  },
  {
    id: "0194b5f0-0004-7000-8000-000000000004",
    bidderUserId: MEERA,
    amountPaise: 130_000n,
    placedAt: new Date("2027-02-01T09:00:00.000Z"),
  },
];

describe("publicBidHistory", () => {
  it("lists bids newest first with bidder numbers in first-bid order", () => {
    expect(publicBidHistory(BIDS)).toEqual([
      {
        bidderNumber: 3,
        amountPaise: 130_000n,
        placedAt: new Date("2027-02-01T09:00:00.000Z"),
      },
      {
        bidderNumber: 2,
        amountPaise: 120_000n,
        placedAt: new Date("2027-02-01T09:00:00.000Z"),
      },
      {
        bidderNumber: 2,
        amountPaise: 110_000n,
        placedAt: new Date("2027-02-01T08:30:00.000Z"),
      },
      {
        bidderNumber: 1,
        amountPaise: 100_000n,
        placedAt: new Date("2027-02-01T08:00:00.000Z"),
      },
    ]);
  });

  it("never carries a user id or a bid id", () => {
    const text = JSON.stringify(publicBidHistory(BIDS), (_key, value) =>
      typeof value === "bigint" ? value.toString() : (value as unknown)
    );
    for (const bid of BIDS) {
      expect(text).not.toContain(bid.bidderUserId);
      expect(text).not.toContain(bid.id);
    }
  });

  it("is empty for a lot with no bids", () => {
    expect(publicBidHistory([])).toEqual([]);
  });
});

describe("viewerStanding", () => {
  it("gives a bidder their own number and says whether they lead", () => {
    expect(viewerStanding(BIDS, MEERA)).toEqual({
      bidderNumber: 3,
      leading: true,
    });
    expect(viewerStanding(BIDS, ASHA)).toEqual({
      bidderNumber: 2,
      leading: false,
    });
  });

  it("has nothing for someone who hasn't bid, or a visitor", () => {
    expect(
      viewerStanding(BIDS, "01938a00-0000-7000-8000-000000000999")
    ).toBeNull();
    expect(viewerStanding(BIDS, null)).toBeNull();
  });
});
