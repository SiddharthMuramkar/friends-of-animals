import { describe, expect, it } from "vitest";

import { XSS_CORPUS } from "@/test/xss-corpus";

import {
  ESSAY_MAX_CHARS,
  essayBodyFromText,
  essayBodyText,
  sanitizeEssayBody,
} from "./essay";

// Invisible characters, by name, so none sits in this file.
const ZWJ = String.fromCodePoint(0x200d);
const POP = String.fromCodePoint(0x202c);
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const BOM = String.fromCodePoint(0xfeff);

// The `essay` profile (#86): a typed essay is paragraphs of lines of plain
// text. Nothing in it is ever markup, because nothing renders it as HTML;
// the profile keeps only that shape and removes characters that can hide
// or reorder text.

describe("essayBodyFromText", () => {
  it("makes a paragraph of each block between blank lines, and a line of each line", () => {
    expect(
      essayBodyFromText("First line\nsecond line\n\n\n  \nNew paragraph\r\n")
    ).toEqual({
      paragraphs: [["First line", "second line"], ["New paragraph"]],
    });
  });

  it("keeps every payload of the corpus as the text it is, in one line", () => {
    for (const payload of XSS_CORPUS) {
      expect(essayBodyFromText(payload)).toEqual({ paragraphs: [[payload]] });
    }
  });

  it("drops control and direction-override characters, keeps joiners", () => {
    expect(
      essayBodyFromText(
        "a\u0007b " +
          RLO +
          "evil" +
          POP +
          " " +
          LRI +
          "x" +
          PDI +
          " " +
          BOM +
          "क्" +
          ZWJ +
          "ष"
      )
    ).toEqual({
      paragraphs: [["ab evil x क्" + ZWJ + "ष"]],
    });
  });

  it("gives back what it was made from", () => {
    const text = "One.\nTwo.\n\nThree.";
    expect(essayBodyText(essayBodyFromText(text))).toBe(text);
  });
});

describe("sanitizeEssayBody", () => {
  it("keeps only paragraphs of lines of strings", () => {
    expect(
      sanitizeEssayBody({
        paragraphs: [
          ["kept", 3, null, { html: "<b>x</b>" }, ["nested"], "  "],
          "not a paragraph",
          [],
          ["also kept\nfolded"],
        ],
        html: "<script>alert(1)</script>",
      })
    ).toEqual({ paragraphs: [["kept"], ["also kept folded"]] });
  });

  it.each([null, undefined, "text", 3, [], [["a"]], { paragraphs: "x" }])(
    "reads %j as an empty essay, without throwing",
    (value) => {
      expect(sanitizeEssayBody(value)).toEqual({ paragraphs: [] });
    }
  );

  it("is idempotent", () => {
    const once = sanitizeEssayBody({
      paragraphs: [[...XSS_CORPUS, "a" + RLO + "b\u0000c  "]],
    });
    expect(sanitizeEssayBody(once)).toEqual(once);
  });

  it("keeps at most the essay's character limit", () => {
    const body = sanitizeEssayBody({
      paragraphs: [["x".repeat(ESSAY_MAX_CHARS)], ["more"]],
    });
    expect(body).toEqual({ paragraphs: [["x".repeat(ESSAY_MAX_CHARS)]] });
  });
});
