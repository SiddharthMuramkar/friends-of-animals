import { describe, expect, it } from "vitest";

import { amountInWords } from "./amount-in-words";

const inr = (amountMinor: bigint) => ({
  amountMinor,
  currency: "INR" as const,
});

describe("amountInWords", () => {
  it.each([
    [100n, "Rupees One Only"],
    [1_100n, "Rupees Eleven Only"],
    [2_100n, "Rupees Twenty-One Only"],
    [9_900n, "Rupees Ninety-Nine Only"],
    [10_000n, "Rupees One Hundred Only"],
    [50_000n, "Rupees Five Hundred Only"],
    [100_500n, "Rupees One Thousand Five Only"],
    [250_000n, "Rupees Two Thousand Five Hundred Only"],
    [10_000_000n, "Rupees One Lakh Only"],
    [
      123_456_789n,
      "Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Eighty-Nine Paise Only",
    ],
    [1_000_000_000n, "Rupees One Crore Only"],
    [
      101_010_100_100n,
      "Rupees One Hundred One Crore One Lakh One Thousand One Only",
    ],
    [150_000_000_000n, "Rupees One Hundred Fifty Crore Only"],
  ])("%i paise reads %j", (amountMinor, words) => {
    expect(amountInWords(inr(amountMinor))).toBe(words);
  });

  it("names paise alone when there are no rupees", () => {
    expect(amountInWords(inr(50n))).toBe("Fifty Paise Only");
    expect(amountInWords(inr(1n))).toBe("One Paise Only");
  });

  it("says zero for nothing", () => {
    expect(amountInWords(inr(0n))).toBe("Rupees Zero Only");
  });

  it("joins rupees and paise", () => {
    expect(amountInWords(inr(50_005n))).toBe(
      "Rupees Five Hundred and Five Paise Only"
    );
  });

  it("refuses a negative amount", () => {
    expect(() => amountInWords(inr(-1n))).toThrow(RangeError);
  });
});
