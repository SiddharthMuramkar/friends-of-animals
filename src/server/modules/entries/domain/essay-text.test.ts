import { describe, expect, it } from "vitest";

import {
  DEFAULT_ESSAY_RULE,
  checkEssayText,
  countWords,
  normaliseEssayText,
} from "./essay-text";

// Invisible characters, by name, so none sits in this file.
const ZWNJ = String.fromCodePoint(0x200c);
const ZWJ = String.fromCodePoint(0x200d);
const POP = String.fromCodePoint(0x202c);
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const BOM = String.fromCodePoint(0xfeff);

const words = (count: number) =>
  Array.from({ length: count }, () => "paw").join(" ");

describe("normaliseEssayText", () => {
  it("turns Windows and old Mac line endings into newlines", () => {
    expect(normaliseEssayText("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("composes accents into single characters", () => {
    expect(normaliseEssayText("café")).toBe("café");
  });

  it("removes control characters but keeps tabs as spaces", () => {
    expect(normaliseEssayText("a\u0000b\u0007c\u007fd\u0085e\tf")).toBe(
      "abcde f"
    );
  });

  it("removes bidirectional overrides that can disguise text", () => {
    expect(
      normaliseEssayText("safe" + RLO + "txt.exe" + POP + " " + LRI + "x" + PDI)
    ).toBe("safetxt.exe x");
  });

  it("keeps the joiners Indian scripts need", () => {
    const kssa = "क्" + ZWJ + "ष"; // ksha, joined by a zero-width joiner
    expect(normaliseEssayText(kssa)).toBe(kssa);
    expect(normaliseEssayText("क्" + ZWNJ + "ष")).toBe("क्" + ZWNJ + "ष");
  });

  it("removes a byte-order mark", () => {
    expect(normaliseEssayText(BOM + "Hello")).toBe("Hello");
  });

  it("trims every line's trailing spaces and the essay's ends", () => {
    expect(normaliseEssayText("  \n First line   \nSecond\t \n\n")).toBe(
      "First line\nSecond"
    );
  });

  it("keeps at most one blank line between paragraphs", () => {
    expect(normaliseEssayText("One\n\n\n\n\nTwo\n \n \nThree")).toBe(
      "One\n\nTwo\n\nThree"
    );
  });
});

describe("countWords", () => {
  it("counts words as a word processor does", () => {
    expect(countWords("Dogs, cats and birds.")).toBe(4);
    expect(countWords("A well-known street dog")).toBe(4);
    expect(countWords("It's 5 o'clock")).toBe(3);
  });

  it("ignores punctuation that stands alone", () => {
    expect(countWords("Wait — what ? ! ...")).toBe(2);
  });

  it("counts words in Indian scripts", () => {
    expect(countWords("कुत्ता और बिल्ली")).toBe(3);
    expect(countWords("நாய் பூனை")).toBe(2);
  });

  it("counts any run of whitespace as one gap", () => {
    expect(countWords("  one\n\ntwo\t three  ")).toBe(3);
  });

  it("is zero for an empty or blank essay", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(" \n\t ")).toBe(0);
  });
});

describe("checkEssayText", () => {
  it("accepts an essay at the word limit and returns it normalised", () => {
    const text = `${words(DEFAULT_ESSAY_RULE.maxWords)}\r\n`;
    expect(checkEssayText(text, DEFAULT_ESSAY_RULE)).toEqual({
      ok: true,
      text: words(DEFAULT_ESSAY_RULE.maxWords),
      wordCount: 1500,
    });
  });

  it("refuses one word over the limit, saying how many there are", () => {
    expect(
      checkEssayText(words(1501), { maxWords: 1500, maxChars: 20_000 })
    ).toEqual({ ok: false, reason: "too_many_words", wordCount: 1501 });
  });

  it("refuses an essay with no words", () => {
    for (const text of ["", "   \n\n ", "... !!! —"]) {
      expect(checkEssayText(text, DEFAULT_ESSAY_RULE)).toEqual({
        ok: false,
        reason: "empty",
        wordCount: 0,
      });
    }
  });

  it("refuses text longer than the character cap, whatever its word count", () => {
    const oneLongWord = "a".repeat(20_001);
    expect(checkEssayText(oneLongWord, DEFAULT_ESSAY_RULE)).toEqual({
      ok: false,
      reason: "too_long",
      wordCount: 1,
    });
  });

  it("measures the cap after normalising, so line endings don't count twice", () => {
    const text = `${"a".repeat(9_999)}\r\n${"b".repeat(10_000)}`;
    expect(checkEssayText(text, DEFAULT_ESSAY_RULE)).toMatchObject({
      ok: true,
      wordCount: 2,
    });
  });
});
