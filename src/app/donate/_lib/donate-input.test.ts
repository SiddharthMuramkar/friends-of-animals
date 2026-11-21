import { describe, expect, it } from "vitest";

import { rupeesToPaise } from "./donate-input";

describe("rupeesToPaise", () => {
  it.each([
    ["500", 50_000n],
    ["0.01", 1n],
    ["500.5", 50_050n],
    ["500.50", 50_050n],
    ["1,500", 150_000n],
    ["1,00,000", 10_000_000n],
    ["  750  ", 75_000n],
    ["₹500", 50_000n],
    ["₹ 2,500", 250_000n],
  ])("reads %j as %s paise", (typed, paise) => {
    expect(rupeesToPaise(typed)).toBe(paise);
  });

  it.each(["", "   ", "abc", "-500", "5e3", "500.", ".5", "500.555", "1.2.3"])(
    "refuses %j",
    (typed) => {
      expect(rupeesToPaise(typed)).toBeNull();
    }
  );

  it("reads zero as zero, for the form to refuse", () => {
    expect(rupeesToPaise("0")).toBe(0n);
  });
});
