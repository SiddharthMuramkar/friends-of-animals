import { describe, expect, it } from "vitest";

import {
  AUCTION_ACCOUNT_CODES,
  auctionCaptureLines,
  creatorSharePercentForInput,
  parseCreatorSharePercent,
  splitProceeds,
} from "./proceeds";

describe("splitProceeds", () => {
  it("rounds the creator's share down and gives the remainder to FOA", () => {
    expect(splitProceeds(100_101n, 2_500)).toEqual({
      creatorSharePaise: 25_025n,
      foaSharePaise: 75_076n,
    });
  });

  it("gives FOA everything when the policy sets no creator share", () => {
    expect(splitProceeds(150_000n, 0)).toEqual({
      creatorSharePaise: 0n,
      foaSharePaise: 150_000n,
    });
  });

  it("gives the creator everything at 100%", () => {
    expect(splitProceeds(150_000n, 10_000)).toEqual({
      creatorSharePaise: 150_000n,
      foaSharePaise: 0n,
    });
  });

  it("leaves a share under one paisa with FOA", () => {
    expect(splitProceeds(1n, 3_333)).toEqual({
      creatorSharePaise: 0n,
      foaSharePaise: 1n,
    });
  });

  it("always adds back up to the amount, and never rounds the share up", () => {
    const amounts = [1n, 99n, 100n, 101n, 12_345n, 99_999_999n, 10n ** 11n];
    const shares = [0, 1, 999, 2_500, 3_333, 5_000, 6_667, 9_999, 10_000];
    for (const amount of amounts) {
      for (const bps of shares) {
        const { creatorSharePaise, foaSharePaise } = splitProceeds(amount, bps);
        expect(creatorSharePaise + foaSharePaise).toBe(amount);
        expect(creatorSharePaise * 10_000n <= amount * BigInt(bps)).toBe(true);
        expect((creatorSharePaise + 1n) * 10_000n > amount * BigInt(bps)).toBe(
          true
        );
      }
    }
  });

  it("refuses an amount that isn't positive", () => {
    expect(() => splitProceeds(0n, 2_500)).toThrow(RangeError);
    expect(() => splitProceeds(-100n, 2_500)).toThrow(RangeError);
  });

  it("refuses a share outside 0 to 10,000 basis points or not whole", () => {
    expect(() => splitProceeds(100n, -1)).toThrow(RangeError);
    expect(() => splitProceeds(100n, 10_001)).toThrow(RangeError);
    expect(() => splitProceeds(100n, 2.5)).toThrow(RangeError);
    expect(() => splitProceeds(100n, Number.NaN)).toThrow(RangeError);
  });
});

describe("auctionCaptureLines", () => {
  it("posts the whole amount to auction proceeds when there's no creator share", () => {
    expect(
      auctionCaptureLines({ amountPaise: 150_000n, creatorShareBps: 0 })
    ).toEqual([
      { accountCode: "1100", side: "debit", amountMinor: 150_000n },
      { accountCode: "4300", side: "credit", amountMinor: 150_000n },
    ]);
  });

  it("splits the credit between FOA's proceeds and the creator-share liability", () => {
    expect(
      auctionCaptureLines({ amountPaise: 100_101n, creatorShareBps: 2_500 })
    ).toEqual([
      { accountCode: "1100", side: "debit", amountMinor: 100_101n },
      { accountCode: "4300", side: "credit", amountMinor: 75_076n },
      { accountCode: "2200", side: "credit", amountMinor: 25_025n },
    ]);
  });

  it("writes no zero line when the creator gets everything", () => {
    expect(
      auctionCaptureLines({ amountPaise: 150_000n, creatorShareBps: 10_000 })
    ).toEqual([
      { accountCode: "1100", side: "debit", amountMinor: 150_000n },
      { accountCode: "2200", side: "credit", amountMinor: 150_000n },
    ]);
  });

  it("names the three accounts the auction posting uses", () => {
    expect(AUCTION_ACCOUNT_CODES).toEqual({
      gatewayClearing: "1100",
      auctionProceeds: "4300",
      creatorSharePayable: "2200",
    });
  });
});

describe("parseCreatorSharePercent", () => {
  it.each([
    ["0", 0],
    ["25", 2_500],
    ["12.5", 1_250],
    ["0.01", 1],
    [" 33.33 ", 3_333],
    ["100", 10_000],
    ["100.00", 10_000],
  ])("reads %j as %i basis points", (input, bps) => {
    expect(parseCreatorSharePercent(input)).toEqual({ ok: true, bps });
  });

  it.each(["", "abc", "12.345", "-5", "1e2", "25%", ".5", "5."])(
    "refuses %j as not a percentage with up to two decimals",
    (input) => {
      expect(parseCreatorSharePercent(input)).toEqual({
        ok: false,
        error: "invalid_percent",
      });
    }
  );

  it("refuses more than 100%", () => {
    expect(parseCreatorSharePercent("100.01")).toEqual({
      ok: false,
      error: "percent_out_of_range",
    });
  });
});

describe("creatorSharePercentForInput", () => {
  it.each([
    [0, "0"],
    [2_500, "25"],
    [1_250, "12.5"],
    [1, "0.01"],
    [3_333, "33.33"],
    [10_000, "100"],
  ])("shows %i basis points as %j", (bps, text) => {
    expect(creatorSharePercentForInput(bps)).toBe(text);
  });
});
