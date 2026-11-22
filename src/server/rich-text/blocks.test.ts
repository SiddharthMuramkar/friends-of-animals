import { describe, expect, it } from "vitest";

import { LEGAL_DOCS } from "../../content/legal";
import { toConsentDocumentBody } from "../modules/consent/domain/document-body";
import {
  LOOKS_LIKE_MARKUP,
  stringsIn,
  XSS_CORPUS,
} from "../../test/xss-corpus";
import {
  sanitizeBlocks,
  sanitizeDocumentBody,
  sanitizeInlines,
  sanitizePlainText,
} from "./blocks";

describe("sanitizeInlines", () => {
  it("keeps text, strong, safe links and known facts", () => {
    const inlines = [
      "Write to ",
      { fact: "email" },
      " or read ",
      { link: "our safeguarding page", href: "/safeguarding" },
      ". ",
      { strong: "Never share passwords." },
    ];
    expect(sanitizeInlines(inlines, "cms")).toEqual(inlines);
  });

  it("strips markup from text, strong and link text", () => {
    expect(
      sanitizeInlines(
        [
          "Hi<script>alert(1)</script> there",
          { strong: "<b>bold</b>" },
          { link: "<img src=x onerror=alert(1)>Home", href: "/" },
        ],
        "cms"
      )
    ).toEqual(["Hi there", { strong: "bold" }, { link: "Home", href: "/" }]);
  });

  it("turns a link with an unsafe address into plain text", () => {
    expect(
      sanitizeInlines(
        [
          { link: "click", href: "javascript:alert(1)" },
          { link: "old", href: "http://example.test/" },
        ],
        "cms"
      )
    ).toEqual(["click", "old"]);
  });

  it("drops empty pieces, unknown facts and unknown shapes", () => {
    expect(
      sanitizeInlines(
        [
          "",
          "<script>gone</script>",
          { strong: "" },
          { link: "", href: "/" },
          { fact: "bankAccount" },
          { clause: ["Only with ", { fact: "email" }] },
          { html: "<b>x</b>" },
          { em: "soft" },
          42,
          null,
          ["nested"],
        ],
        "cms"
      )
    ).toEqual([]);
  });

  it("rebuilds known shapes without extra keys", () => {
    expect(
      sanitizeInlines(
        [
          { strong: "Yes", onclick: "alert(1)" },
          { link: "Home", href: "/", target: "_blank", style: "x" },
        ],
        "cms"
      )
    ).toEqual([{ strong: "Yes" }, { link: "Home", href: "/" }]);
  });

  it("returns nothing for something that is not a list", () => {
    expect(sanitizeInlines("just a string", "cms")).toEqual([]);
    expect(sanitizeInlines({ p: ["x"] }, "cms")).toEqual([]);
  });
});

describe("sanitizeBlocks", () => {
  it("keeps paragraphs and lists, dropping empty ones", () => {
    expect(
      sanitizeBlocks(
        [
          { p: ["One"] },
          { p: ["<script>x</script>"] },
          { list: [["A"], ["<iframe>b</iframe>"], [{ strong: "C" }]] },
          { list: [[""]] },
          { h1: ["Not a block"] },
          { p: ["Two"], list: [["ambiguous"]] },
        ],
        "cms"
      )
    ).toEqual([{ p: ["One"] }, { list: [["A"], [{ strong: "C" }]] }]);
  });
});

describe("sanitizeDocumentBody", () => {
  it("passes all four policy documents, as they are published, through unchanged", () => {
    for (const [id, doc] of Object.entries(LEGAL_DOCS)) {
      const body = toConsentDocumentBody(doc);
      expect(sanitizeDocumentBody(body, "cms"), id).toEqual(body);
    }
  });

  it("drops sections without a title or content and fixes bad anchor ids", () => {
    expect(
      sanitizeDocumentBody(
        {
          short: [["Short <b>point</b>"], []],
          sections: [
            { id: "who-we-are", title: "Who we are", blocks: [{ p: ["A"] }] },
            { id: "Bad Id!", title: "Second", blocks: [{ p: ["B"] }] },
            { id: "who-we-are", title: "Dup", blocks: [{ p: ["C"] }] },
            {
              id: "empty",
              title: "<script>x</script>",
              blocks: [{ p: ["D"] }],
            },
            { id: "no-blocks", title: "Nothing here", blocks: [] },
            "not a section",
          ],
        },
        "cms"
      )
    ).toEqual({
      short: [["Short point"]],
      sections: [
        { id: "who-we-are", title: "Who we are", blocks: [{ p: ["A"] }] },
        { id: "bad-id", title: "Second", blocks: [{ p: ["B"] }] },
        { id: "who-we-are-2", title: "Dup", blocks: [{ p: ["C"] }] },
      ],
    });
  });

  it("gives an empty body for anything else", () => {
    for (const value of [null, undefined, "x", 1, [], { short: "x" }]) {
      expect(sanitizeDocumentBody(value, "cms")).toEqual({
        short: [],
        sections: [],
      });
    }
  });

  it("leaves no markup, handler or script address from the corpus", () => {
    const body = {
      short: XSS_CORPUS.map((payload) => [payload]),
      sections: XSS_CORPUS.map((payload, i) => ({
        id: `s-${i}`,
        title: `T ${payload}`,
        blocks: [
          { p: [payload, { strong: payload }] },
          { p: [{ link: `L ${payload}`, href: payload }] },
          { list: [[payload]] },
        ],
      })),
    };
    const clean = sanitizeDocumentBody(body, "cms");
    for (const text of stringsIn(clean)) {
      expect(text).not.toMatch(LOOKS_LIKE_MARKUP);
    }
    expect(clean.sections).toHaveLength(XSS_CORPUS.length);
  });

  it("is idempotent", () => {
    const body = {
      short: XSS_CORPUS.map((payload) => [payload]),
      sections: [{ id: "A b", title: "<i>T</i>", blocks: [{ p: XSS_CORPUS }] }],
    };
    const once = sanitizeDocumentBody(body, "cms");
    expect(sanitizeDocumentBody(once, "cms")).toEqual(once);
  });
});

describe("sanitizePlainText", () => {
  it("strips markup and trims a one-line field", () => {
    expect(sanitizePlainText("  Kind <b>kids</b><script>x</script>  ")).toBe(
      "Kind kids"
    );
    expect(sanitizePlainText(42)).toBe("");
  });
});
