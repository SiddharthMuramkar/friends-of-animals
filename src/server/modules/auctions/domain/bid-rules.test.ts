import { describe, expect, it } from "vitest";

import {
  decideBid,
  minimumNextBid,
  type BidRules,
  type LotSnapshot,
} from "./bid-rules";

const ASHA = "01938a00-0000-7000-8000-000000000101";
const RAVI = "01938a00-0000-7000-8000-000000000102";
const MEERA = "01938a00-0000-7000-8000-000000000103";

const RULES: BidRules = {
  minIncrementPaise: 10_000n, // ₹100
  antiSnipingWindowMinutes: 5,
};

const OPEN_LOT: LotSnapshot = {
  status: "open",
  opensAt: new Date("2027-02-01T04:30:00.000Z"),
  closesAt: new Date("2027-02-01T12:30:00.000Z"),
  basePricePaise: 50_000n, // ₹500
  currentBidPaise: null,
  currentBidderUserId: null,
};

const MIDDAY = new Date("2027-02-01T08:00:00.000Z");

/** The open lot with Asha leading at ₹1,000 after three bids. */
const ASHA_LEADS: LotSnapshot = {
  ...OPEN_LOT,
  currentBidPaise: 100_000n,
  currentBidderUserId: ASHA,
};

describe("minimumNextBid", () => {
  it("is the base price before anyone has bid", () => {
    expect(minimumNextBid(OPEN_LOT, RULES)).toBe(50_000n);
  });

  it("is the current highest bid plus the increment after that", () => {
    expect(minimumNextBid(ASHA_LEADS, RULES)).toBe(110_000n);
  });
});

describe("decideBid: amounts", () => {
  it("accepts a first bid at exactly the base price", () => {
    const decision = decideBid({
      lot: OPEN_LOT,
      bidderUserId: ASHA,
      amountPaise: 50_000n,
      placedAt: MIDDAY,
      rules: RULES,
    });
    expect(decision).toEqual({
      ok: true,
      next: {
        ...OPEN_LOT,
        currentBidPaise: 50_000n,
        currentBidderUserId: ASHA,
      },
      outbidUserId: null,
      extended: false,
    });
  });

  it("refuses a first bid below the base price and says what the minimum is", () => {
    expect(
      decideBid({
        lot: OPEN_LOT,
        bidderUserId: ASHA,
        amountPaise: 49_900n,
        placedAt: MIDDAY,
        rules: RULES,
      })
    ).toEqual({ ok: false, reason: "bid_below_base", minimumPaise: 50_000n });
  });

  it("refuses a bid below the current highest plus the increment", () => {
    expect(
      decideBid({
        lot: ASHA_LEADS,
        bidderUserId: RAVI,
        amountPaise: 109_900n,
        placedAt: MIDDAY,
        rules: RULES,
      })
    ).toEqual({ ok: false, reason: "bid_too_low", minimumPaise: 110_000n });
  });

  it("refuses a bid equal to the current highest", () => {
    expect(
      decideBid({
        lot: ASHA_LEADS,
        bidderUserId: RAVI,
        amountPaise: 100_000n,
        placedAt: MIDDAY,
        rules: RULES,
      })
    ).toMatchObject({ ok: false, reason: "bid_too_low" });
  });

  it("accepts a bid of exactly the current highest plus the increment and names who was outbid", () => {
    expect(
      decideBid({
        lot: ASHA_LEADS,
        bidderUserId: RAVI,
        amountPaise: 110_000n,
        placedAt: MIDDAY,
        rules: RULES,
      })
    ).toEqual({
      ok: true,
      next: {
        ...ASHA_LEADS,
        currentBidPaise: 110_000n,
        currentBidderUserId: RAVI,
      },
      outbidUserId: ASHA,
      extended: false,
    });
  });

  it("lets the leader raise their own bid without outbidding anyone", () => {
    expect(
      decideBid({
        lot: ASHA_LEADS,
        bidderUserId: ASHA,
        amountPaise: 150_000n,
        placedAt: MIDDAY,
        rules: RULES,
      })
    ).toMatchObject({
      ok: true,
      next: { currentBidPaise: 150_000n, currentBidderUserId: ASHA },
      outbidUserId: null,
    });
  });

  it("refuses zero and negative amounts", () => {
    for (const amountPaise of [0n, -10_000n]) {
      expect(
        decideBid({
          lot: OPEN_LOT,
          bidderUserId: ASHA,
          amountPaise,
          placedAt: MIDDAY,
          rules: RULES,
        })
      ).toEqual({ ok: false, reason: "invalid_amount" });
    }
  });

  it("refuses to run with an increment that isn't positive", () => {
    expect(() =>
      decideBid({
        lot: OPEN_LOT,
        bidderUserId: ASHA,
        amountPaise: 50_000n,
        placedAt: MIDDAY,
        rules: { ...RULES, minIncrementPaise: 0n },
      })
    ).toThrow(RangeError);
  });
});

describe("decideBid: two bids from the same snapshot", () => {
  it("accepts only the first when both are decided against the latest state in turn", () => {
    const first = decideBid({
      lot: ASHA_LEADS,
      bidderUserId: RAVI,
      amountPaise: 110_000n,
      placedAt: MIDDAY,
      rules: RULES,
    });
    if (!first.ok) throw new Error("the first bid should be accepted");
    const second = decideBid({
      lot: first.next,
      bidderUserId: MEERA,
      amountPaise: 110_000n,
      placedAt: MIDDAY,
      rules: RULES,
    });
    expect(second).toEqual({
      ok: false,
      reason: "bid_too_low",
      minimumPaise: 120_000n,
    });
  });

  it("refuses a higher bid that no longer clears the increment over the bid that landed first", () => {
    const first = decideBid({
      lot: ASHA_LEADS,
      bidderUserId: RAVI,
      amountPaise: 110_000n,
      placedAt: MIDDAY,
      rules: RULES,
    });
    if (!first.ok) throw new Error("the first bid should be accepted");
    expect(
      decideBid({
        lot: first.next,
        bidderUserId: MEERA,
        amountPaise: 115_000n,
        placedAt: MIDDAY,
        rules: RULES,
      })
    ).toMatchObject({ ok: false, reason: "bid_too_low" });
  });
});

describe("decideBid: when bidding is open", () => {
  it("refuses bids on a lot that hasn't opened", () => {
    for (const status of ["draft", "scheduled"]) {
      expect(
        decideBid({
          lot: { ...OPEN_LOT, status },
          bidderUserId: ASHA,
          amountPaise: 50_000n,
          placedAt: MIDDAY,
          rules: RULES,
        })
      ).toEqual({ ok: false, reason: "lot_not_open" });
    }
  });

  it("refuses a bid before the opening time even if the lot is marked open", () => {
    expect(
      decideBid({
        lot: OPEN_LOT,
        bidderUserId: ASHA,
        amountPaise: 50_000n,
        placedAt: new Date("2027-02-01T04:29:59.999Z"),
        rules: RULES,
      })
    ).toEqual({ ok: false, reason: "lot_not_open" });
  });

  it("refuses a bid at or after the closing time, even before the close job has run", () => {
    for (const placedAt of [
      OPEN_LOT.closesAt,
      new Date("2027-02-01T12:31:00.000Z"),
    ]) {
      expect(
        decideBid({
          lot: OPEN_LOT,
          bidderUserId: ASHA,
          amountPaise: 50_000n,
          placedAt,
          rules: RULES,
        })
      ).toEqual({ ok: false, reason: "lot_closed" });
    }
  });

  it("refuses bids on a lot that has ended for any reason", () => {
    for (const status of [
      "closed",
      "awaiting_payment",
      "sold",
      "unsold",
      "relisted",
      "cancelled",
    ]) {
      expect(
        decideBid({
          lot: { ...OPEN_LOT, status },
          bidderUserId: ASHA,
          amountPaise: 50_000n,
          placedAt: MIDDAY,
          rules: RULES,
        })
      ).toEqual({ ok: false, reason: "lot_closed" });
    }
  });

  it("checks the lot before the amount", () => {
    expect(
      decideBid({
        lot: { ...ASHA_LEADS, status: "closed" },
        bidderUserId: RAVI,
        amountPaise: 1n,
        placedAt: MIDDAY,
        rules: RULES,
      })
    ).toEqual({ ok: false, reason: "lot_closed" });
  });
});

describe("decideBid: anti-sniping", () => {
  it("extends the close by the window for a bid one second inside it and reports the extension", () => {
    expect(
      decideBid({
        lot: ASHA_LEADS,
        bidderUserId: RAVI,
        amountPaise: 110_000n,
        placedAt: new Date("2027-02-01T12:25:01.000Z"),
        rules: RULES,
      })
    ).toMatchObject({
      ok: true,
      next: {
        closesAt: new Date("2027-02-01T12:35:00.000Z"),
      },
      extended: true,
    });
  });

  it("accepts a bid after the original close once the lot was extended", () => {
    const extended: LotSnapshot = {
      ...ASHA_LEADS,
      closesAt: new Date("2027-02-01T12:35:00.000Z"),
    };
    expect(
      decideBid({
        lot: extended,
        bidderUserId: RAVI,
        amountPaise: 110_000n,
        placedAt: new Date("2027-02-01T12:32:00.000Z"),
        rules: RULES,
      })
    ).toMatchObject({
      ok: true,
      next: {
        closesAt: new Date("2027-02-01T12:40:00.000Z"),
      },
    });
  });

  it("doesn't extend for a refused bid", () => {
    expect(
      decideBid({
        lot: ASHA_LEADS,
        bidderUserId: RAVI,
        amountPaise: 100_500n,
        placedAt: new Date("2027-02-01T12:29:00.000Z"),
        rules: RULES,
      })
    ).toMatchObject({ ok: false, reason: "bid_too_low" });
  });
});
