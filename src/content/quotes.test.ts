import { describe, expect, it } from "vitest";

import { QUOTES, QUOTE_IDS, attribution, quote } from "./quotes";

// quotes.md §4 and §6: misattributed or misquoted lines that must never ship.
const DO_NOT_USE = [
  /greatness of a nation/i,
  /life in the air/i,
  /be the change/i,
  /circle of (his )?compassion/i,
  /most noble attribute/i,
  /don'?t limit a child/i,
  /murder of animals/i,
  /animal rights as well as human rights/i,
  /until one has loved an animal/i,
];

describe("quote bank", () => {
  it("has unique ids", () => {
    expect(new Set(QUOTE_IDS).size).toBe(QUOTES.length);
  });

  it("covers the placement map and the strong alternates", () => {
    for (const id of [
      "Q01",
      "Q02",
      "Q03",
      "Q04",
      "Q08",
      "Q09",
      "Q10a",
      "Q10b",
      "Q11",
      "Q12",
      "Q15",
      "Q19",
      "Q21",
      "Q22",
      "Q24",
      "Q25",
      "Q26",
      "Q29",
      "Q32a",
      "Q34",
      "Q36",
      "Q37",
      "Q39",
      "Q40",
      "Q42",
      "Q44",
    ])
      expect(QUOTE_IDS).toContain(id);
  });

  it("only holds verified or reliably attributed quotes with a source", () => {
    for (const q of QUOTES) {
      expect(["VERIFIED", "ATTRIBUTED-RELIABLE"]).toContain(q.verdict);
      expect(q.sourceUrl ?? q.citation, q.id).toBeTruthy();
    }
  });

  it("never edits the source text: each display piece is in the text", () => {
    for (const q of QUOTES) {
      if (!q.display) continue;
      for (const piece of q.display.split("…").map((p) => p.trim()))
        if (piece) expect(q.text, q.id).toContain(piece);
    }
  });

  it("contains nothing from the do-not-use list", () => {
    for (const q of QUOTES)
      for (const re of DO_NOT_USE) expect(q.text, q.id).not.toMatch(re);
  });

  it("formats the attribution line", () => {
    expect(attribution(quote("Q22"))).toBe(
      "Rabindranath Tagore, Stray Birds (1916), no. 123"
    );
    expect(attribution(quote("Q21"))).toBe(
      "Kalidasa, Shakuntala, Act I, translated by Arthur W. Ryder (1912)"
    );
  });
});
