import { describe, expect, it } from "vitest";

import { article as drawing } from "@/content/stories/articles/a-drawing-that-feeds-tiny-guests";
import { article as kites } from "@/content/stories/articles/kinder-skies-in-kite-season";
import { article as rukmini } from "@/content/stories/articles/rukmini-devi-and-indias-animal-law";
import { article as stork } from "@/content/stories/articles/the-stork-that-gets-a-baby-shower";
import { article as pilots } from "@/content/stories/articles/two-pilots-two-puppies";

import { postImageIdsIn, sanitizePostBody } from "./post-body";
import { LOOKS_LIKE_MARKUP, stringsIn, XSS_CORPUS } from "./xss-corpus";

const IMAGE_A = "0190f0e0-0000-7000-8000-00000000000a";
const IMAGE_B = "0190f0e0-0000-7000-8000-00000000000b";

const SOURCE = {
  id: "f1",
  text: "Blue Cross of India, “Our history”",
  url: "https://bluecross.org.in/history",
};

describe("sanitizePostBody", () => {
  it.each([
    ["rukmini-devi-and-indias-animal-law", rukmini],
    ["a-drawing-that-feeds-tiny-guests", drawing],
    ["the-stork-that-gets-a-baby-shower", stork],
    ["two-pilots-two-puppies", pilots],
    ["kinder-skies-in-kite-season", kites],
  ])("keeps the published story %s exactly as it is", (_slug, article) => {
    expect(sanitizePostBody(article)).toEqual(article);
  });

  it("keeps every block type, with images referenced by id", () => {
    const body = {
      blocks: [
        {
          type: "paragraph",
          text: [
            "Plain, ",
            { em: "leaning" },
            ", ",
            { strong: "bold" },
            ", a ",
            { link: "page", href: "/about" },
            ".",
            { fn: "f1" },
          ],
        },
        { type: "heading", level: 2, text: "Two" },
        { type: "heading", level: 3, text: "Three" },
        { type: "quote", quoteId: "Q44" },
        {
          type: "sourceQuote",
          text: "Exact words",
          attribution: "A report, 2021",
          fn: "f1",
        },
        { type: "image", postImageId: IMAGE_A, caption: "A kite in a tree" },
        { type: "image", postImageId: IMAGE_B },
        { type: "image", siteImageId: "care-kolam-rice", caption: "Kolam" },
        { type: "list", style: "bullet", items: [["One"], ["Two"]] },
        { type: "list", style: "number", items: [["First"]] },
        {
          type: "callout",
          tone: "info",
          title: "What you can do",
          body: [["Be kind."], ["Tell a grown-up."]],
        },
        { type: "callout", tone: "warning", body: [["Careful."]] },
      ],
      footnotes: [SOURCE],
    };

    expect(sanitizePostBody(body)).toEqual(body);
  });

  it("leaves no markup in any field for any payload in the corpus", () => {
    for (const payload of XSS_CORPUS) {
      const text = `Before ${payload} after`;
      const body = sanitizePostBody({
        blocks: [
          {
            type: "paragraph",
            text: [
              text,
              { em: text },
              { strong: text },
              { link: text, href: "/x" },
              { fn: "f1" },
            ],
          },
          { type: "heading", level: 2, text },
          { type: "sourceQuote", text, attribution: text, fn: "f1" },
          { type: "image", postImageId: IMAGE_A, caption: text },
          { type: "list", style: "bullet", items: [[text]] },
          { type: "callout", tone: "info", title: text, body: [[text]] },
        ],
        footnotes: [{ id: "f1", text, url: SOURCE.url }],
      });

      const left = stringsIn(body).filter((s) => LOOKS_LIKE_MARKUP.test(s));
      expect(left, payload).toEqual([]);
      expect(body.blocks, payload).toHaveLength(6);
    }
  });

  it("turns a link with an unsafe address into its text", () => {
    const body = sanitizePostBody({
      blocks: [
        {
          type: "paragraph",
          text: [
            { link: "one", href: "javascript:alert(1)" },
            " ",
            { link: "two", href: "data:text/html,x" },
            " ",
            { link: "three", href: "http://example.test/" },
            " ",
            { link: "four", href: "//evil.test/" },
          ],
        },
      ],
      footnotes: [],
    });

    expect(body.blocks).toEqual([
      { type: "paragraph", text: ["one", " ", "two", " ", "three", " ", "four"] },
    ]);
  });

  it("drops an image's src, url or storage key and keeps only its id", () => {
    const body = sanitizePostBody({
      blocks: [
        {
          type: "image",
          postImageId: IMAGE_A,
          src: "https://evil.test/x.png",
          url: "https://private.r2.test/originals/x.jpg",
          key: "originals/x.jpg",
          caption: "Kept",
        },
        { type: "image", src: "https://evil.test/x.png" },
        { type: "image", key: "originals/x.jpg", caption: "No id" },
      ],
      footnotes: [],
    });

    expect(body.blocks).toEqual([
      { type: "image", postImageId: IMAGE_A, caption: "Kept" },
    ]);
  });

  it("drops an image whose reference is not an id it knows how to resolve", () => {
    const body = sanitizePostBody({
      blocks: [
        { type: "image", postImageId: "../../originals/x.jpg" },
        { type: "image", postImageId: "https://evil.test/x.png" },
        { type: "image", siteImageId: "not-a-site-image" },
        { type: "image", postImageId: IMAGE_A, siteImageId: "care-kolam-rice" },
      ],
      footnotes: [],
    });

    expect(body.blocks).toEqual([]);
  });

  it("drops unknown block types, unknown values and extra keys", () => {
    const body = sanitizePostBody({
      blocks: [
        { type: "html", html: "<b>hi</b>" },
        { type: "embed", url: "https://evil.test/" },
        { type: "heading", level: 1, text: "Too big" },
        { type: "heading", level: 4, text: "Too small" },
        { type: "quote", quoteId: "not-in-the-bank" },
        { type: "list", style: "roman", items: [["i"]] },
        { type: "callout", tone: "rainbow", body: [["Hi"]] },
        {
          type: "paragraph",
          text: ["Kept", { u: "underline" }, { em: "em", style: "x" }],
          onclick: "alert(1)",
        },
      ],
      footnotes: [],
      script: "alert(1)",
    });

    expect(body).toEqual({
      blocks: [{ type: "paragraph", text: ["Kept", { em: "em" }] }],
      footnotes: [],
    });
  });

  it("keeps sources that are cited and safe, and drops references to any other", () => {
    const body = sanitizePostBody({
      blocks: [
        {
          type: "paragraph",
          text: ["A", { fn: "f1" }, "B", { fn: "f2" }, "C", { fn: "f9" }],
        },
        { type: "sourceQuote", text: "Q", attribution: "R", fn: "f2" },
        { type: "sourceQuote", text: "Q", attribution: "R", fn: "f9" },
      ],
      footnotes: [
        SOURCE,
        { id: "f1", text: "Duplicate", url: "https://example.test/dup" },
        { id: "f2", text: "Unsafe", url: "javascript:alert(1)" },
        { id: "f3", text: "Never cited", url: "https://example.test/3" },
        { id: "x4", text: "Bad id", url: "https://example.test/4" },
      ],
    });

    expect(body).toEqual({
      blocks: [{ type: "paragraph", text: ["A", { fn: "f1" }, "B", "C"] }],
      footnotes: [SOURCE],
    });
  });

  it("drops empty text, empty items and blocks left with nothing in them", () => {
    const body = sanitizePostBody({
      blocks: [
        { type: "paragraph", text: ["", { em: "" }, "<b></b>"] },
        { type: "heading", level: 2, text: "   " },
        { type: "list", style: "bullet", items: [[""], [], ["Kept"]] },
        { type: "callout", tone: "info", title: "", body: [[""]] },
        { type: "callout", tone: "info", title: "<i></i>", body: [["Body"]] },
        { type: "image", postImageId: IMAGE_A, caption: "" },
      ],
      footnotes: [],
    });

    expect(body.blocks).toEqual([
      { type: "list", style: "bullet", items: [["Kept"]] },
      { type: "callout", tone: "info", body: [["Body"]] },
      { type: "image", postImageId: IMAGE_A },
    ]);
  });

  it("returns what it is given when the input is already clean", () => {
    const messy = {
      blocks: [
        {
          type: "paragraph",
          text: ["<scr<script>ipt>x", { fn: "f1" }, { fn: "f2" }],
        },
        { type: "heading", level: 3, text: "<b>Hi</b>  there" },
        { type: "image", postImageId: IMAGE_A, src: "x" },
      ],
      footnotes: [
        SOURCE,
        { id: "f2", text: "<i>x</i>", url: "javascript:alert(1)" },
      ],
    };
    const once = sanitizePostBody(messy);

    expect(sanitizePostBody(once)).toEqual(once);
  });

  it.each([null, undefined, "text", 42, [], { blocks: "x", footnotes: 1 }])(
    "returns an empty body for %j instead of throwing",
    (value) => {
      expect(sanitizePostBody(value)).toEqual({ blocks: [], footnotes: [] });
    }
  );
});

describe("postImageIdsIn", () => {
  it("lists each uploaded image a body shows once, in order, and no site images", () => {
    const body = sanitizePostBody({
      blocks: [
        { type: "image", postImageId: IMAGE_B },
        { type: "image", siteImageId: "care-kolam-rice" },
        { type: "image", postImageId: IMAGE_A },
        { type: "image", postImageId: IMAGE_B, caption: "Again" },
      ],
      footnotes: [],
    });

    expect(postImageIdsIn(body)).toEqual([IMAGE_B, IMAGE_A]);
  });
});
