import { describe, expect, it } from "vitest";

import { maskPan, parsePan, type Pan } from "./pan";

describe("parsePan", () => {
  it.each([
    ["ABCPE1234F", "ABCPE1234F"],
    // Typed in lower case, with spaces around and inside.
    ["  abcpe1234f ", "ABCPE1234F"],
    ["ABCPE 1234 F", "ABCPE1234F"],
    // Every holder type the fourth letter can name.
    ["AAACB1234C", "AAACB1234C"],
    ["AAAHB1234C", "AAAHB1234C"],
    ["AAAFB1234C", "AAAFB1234C"],
    ["AAAAB1234C", "AAAAB1234C"],
    ["AAATB1234C", "AAATB1234C"],
    ["AAABB1234C", "AAABB1234C"],
    ["AAALB1234C", "AAALB1234C"],
    ["AAAJB1234C", "AAAJB1234C"],
    ["AAAGB1234C", "AAAGB1234C"],
  ])("reads %j as %s", (input, pan) => {
    expect(parsePan(input)).toBe(pan);
  });

  it.each([
    "",
    "   ",
    // Too short, too long.
    "ABCPE1234",
    "ABCPE1234FF",
    // Digits and letters in the wrong places.
    "ABCP51234F",
    "ABCPEA234F",
    "ABCPE12345",
    "1BCPE1234F",
    // The fourth letter names no holder type.
    "ABCXE1234F",
    "ABCDE1234F",
    // Punctuation is not forgiven, only spaces.
    "ABCPE-1234-F",
    // Non-ASCII look-alikes, including letters that upper-case to ASCII
    // (dotless i to I, long s to S).
    "ＡBCPE1234F",
    "ABCPE1234ſ",
    "ıBCPE1234F",
  ])("refuses %j", (input) => {
    expect(parsePan(input)).toBeNull();
  });
});

describe("maskPan", () => {
  it("keeps only the last four characters", () => {
    expect(maskPan("ABCPE1234F" as Pan)).toBe("XXXXXX234F");
    expect(maskPan(parsePan("aaacb 9876 c")!)).toBe("XXXXXX876C");
  });
});
