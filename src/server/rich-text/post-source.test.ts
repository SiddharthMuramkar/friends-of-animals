import { describe, expect, it } from "vitest";

import { article as drawing } from "@/content/stories/articles/a-drawing-that-feeds-tiny-guests";
import { article as kites } from "@/content/stories/articles/kinder-skies-in-kite-season";
import { article as rukmini } from "@/content/stories/articles/rukmini-devi-and-indias-animal-law";
import { article as stork } from "@/content/stories/articles/the-stork-that-gets-a-baby-shower";
import { article as pilots } from "@/content/stories/articles/two-pilots-two-puppies";

import { sanitizePostBody, type PostBody } from "./post-body";
import { formatPostSource, parsePostSource } from "./post-source";

const IMAGE_A = "0190f0e0-0000-7000-8000-00000000000a";

const EVERY_BLOCK = `A paragraph with *emphasis*, **strong text**,
a [link](https://example.org/page) and a source mark.[^f1]

## A heading

### A smaller heading

- A bullet item
- Another, with [a page](/about)

1. A numbered item
2. The second

> [!info] An optional title
> A callout paragraph
> on two lines.
>
> Another paragraph.

> [!warning]
> No title here.

> Exact words from a source
> — Who said it, where [^f1]

@quote Q44

@image ${IMAGE_A} A kite caught in a tree

@image site:care-kolam-rice

[^f1]: Publisher, “Title”, 12 Jan 2026 <https://example.org/source>
`;

const EVERY_BLOCK_BODY: PostBody = {
  blocks: [
    {
      type: "paragraph",
      text: [
        "A paragraph with ",
        { em: "emphasis" },
        ", ",
        { strong: "strong text" },
        ", a ",
        { link: "link", href: "https://example.org/page" },
        " and a source mark.",
        { fn: "f1" },
      ],
    },
    { type: "heading", level: 2, text: "A heading" },
    { type: "heading", level: 3, text: "A smaller heading" },
    {
      type: "list",
      style: "bullet",
      items: [
        ["A bullet item"],
        ["Another, with ", { link: "a page", href: "/about" }],
      ],
    },
    {
      type: "list",
      style: "number",
      items: [["A numbered item"], ["The second"]],
    },
    {
      type: "callout",
      tone: "info",
      title: "An optional title",
      body: [["A callout paragraph on two lines."], ["Another paragraph."]],
    },
    { type: "callout", tone: "warning", body: [["No title here."]] },
    {
      type: "sourceQuote",
      text: "Exact words from a source",
      attribution: "Who said it, where",
      fn: "f1",
    },
    { type: "quote", quoteId: "Q44" },
    { type: "image", postImageId: IMAGE_A, caption: "A kite caught in a tree" },
    { type: "image", siteImageId: "care-kolam-rice" },
  ],
  footnotes: [
    {
      id: "f1",
      text: "Publisher, “Title”, 12 Jan 2026",
      url: "https://example.org/source",
    },
  ],
};

function errorsOf(source: string) {
  const parsed = parsePostSource(source);
  return parsed.ok ? [] : parsed.errors;
}

describe("parsePostSource", () => {
  it("reads every kind of block", () => {
    expect(parsePostSource(EVERY_BLOCK)).toEqual({
      ok: true,
      body: EVERY_BLOCK_BODY,
    });
  });

  it("strips markup typed into the source, as every save does", () => {
    expect(parsePostSource("Hi <script>alert(1)</script>there")).toEqual({
      ok: true,
      body: {
        blocks: [{ type: "paragraph", text: ["Hi there"] }],
        footnotes: [],
      },
    });
  });

  it.each([
    ["Some **strong", 1, "unclosed_strong"],
    ["Some *leaning", 1, "unclosed_em"],
    ["Empty ****", 1, "empty_mark"],
    ["A [link without an address]", 1, "unclosed_link"],
    ["A [link](https://example.org", 1, "unclosed_link"],
    ["A [bad link](javascript:alert(1))", 1, "invalid_link"],
    ["An [](/about)", 1, "invalid_link"],
    ["Ends with a backslash \\", 1, "dangling_escape"],
    ["Text\n\n# Too big", 3, "invalid_heading"],
    ["#### Too small", 1, "invalid_heading"],
    ["A mark[^note]", 1, "invalid_footnote_ref"],
    ["Cites a missing source.[^f2]", 1, "unknown_footnote"],
    ["@quote Q999", 1, "unknown_quote"],
    ["@image site:not-a-site-image", 1, "unknown_site_image"],
    ["@image https://evil.test/x.png", 1, "invalid_image"],
    ["@image", 1, "invalid_image"],
    ["@embed https://evil.test/", 1, "unknown_directive"],
    ["> [!rainbow] Title\n> Body", 1, "invalid_callout"],
    ["> [!info] Title", 1, "empty_callout"],
    ["> Words with no attribution", 1, "invalid_source_quote"],
    [
      "> — Only an attribution [^f1]\n\n[^f1]: A <https://a.test/>",
      1,
      "invalid_source_quote",
    ],
  ])("refuses %j with %s at line %i", (source, line, code) => {
    expect(errorsOf(source)).toContainEqual({ line, code });
  });

  it("refuses sources that are broken, repeated or never cited, at their lines", () => {
    const source = [
      "Cites one.[^f1]",
      "",
      "[^f1]: First <https://example.org/1>",
      "[^f1]: Again <https://example.org/2>",
      "[^f2]: Never cited <https://example.org/3>",
      "[^f3]: No address",
      "[^f4]: Unsafe <javascript:alert(1)>",
    ].join("\n");

    expect(errorsOf(source)).toEqual([
      { line: 4, code: "duplicate_footnote" },
      { line: 5, code: "uncited_footnote" },
      { line: 6, code: "invalid_footnote" },
      { line: 7, code: "invalid_footnote" },
    ]);
  });

  it("reports every error at once, in line order", () => {
    expect(errorsOf("**open\n\nfine\n\n@quote nope\n\n*open")).toEqual([
      { line: 1, code: "unclosed_strong" },
      { line: 5, code: "unknown_quote" },
      { line: 7, code: "unclosed_em" },
    ]);
  });

  it.each(["", "\n\n   \n"])("refuses an empty body %j", (source) => {
    expect(errorsOf(source)).toEqual([{ line: null, code: "empty_body" }]);
  });

  it("joins neighbouring lines and treats a backslash as making the next character plain", () => {
    expect(
      parsePostSource(
        "\\# Not a heading, \\*not leaning\\*,\nand \\[not a link\\]"
      )
    ).toEqual({
      ok: true,
      body: {
        blocks: [
          {
            type: "paragraph",
            text: ["# Not a heading, *not leaning*, and [not a link]"],
          },
        ],
        footnotes: [],
      },
    });
  });
});

describe("formatPostSource", () => {
  it("writes the source it reads", () => {
    expect(formatPostSource(EVERY_BLOCK_BODY)).toBe(
      EVERY_BLOCK.replace(
        "A paragraph with *emphasis*, **strong text**,\na [link]",
        "A paragraph with *emphasis*, **strong text**, a [link]"
      ).replace(
        "> A callout paragraph\n> on two lines.",
        "> A callout paragraph on two lines."
      )
    );
  });

  it.each([
    ["rukmini-devi-and-indias-animal-law", rukmini],
    ["a-drawing-that-feeds-tiny-guests", drawing],
    ["the-stork-that-gets-a-baby-shower", stork],
    ["two-pilots-two-puppies", pilots],
    ["kinder-skies-in-kite-season", kites],
  ])("round-trips the published story %s", (_slug, article) => {
    // A story's type allows any quote id string; the post type names the
    // bank's ids, so the story goes in through the sanitiser.
    const body = sanitizePostBody(article);

    expect(parsePostSource(formatPostSource(body))).toEqual({
      ok: true,
      body: article,
    });
  });

  it("escapes text that would otherwise read as markup", () => {
    const body: PostBody = {
      blocks: [
        { type: "paragraph", text: ["# not a heading"] },
        { type: "paragraph", text: ["- not a list"] },
        { type: "paragraph", text: ["1960. Not a numbered list"] },
        { type: "paragraph", text: ["> not a quote"] },
        { type: "paragraph", text: ["@quote not a directive"] },
        { type: "paragraph", text: ["[^f1]: not a source"] },
        { type: "paragraph", text: ["Stars * and [brackets] and \\ slashes"] },
        {
          type: "paragraph",
          text: [{ link: "^f1 label", href: "/about" }, " and ", { em: "a*b" }],
        },
        { type: "heading", level: 2, text: "Heading with *stars*" },
        {
          type: "sourceQuote",
          text: "[!info] not a callout",
          attribution: "Someone [^f9] odd",
          fn: "f1",
        },
        {
          type: "callout",
          tone: "info",
          title: "Title [x]",
          body: [["> nested?"]],
        },
        {
          type: "image",
          siteImageId: "care-kolam-rice",
          caption: "A *caption*",
        },
      ],
      footnotes: [
        {
          id: "f1",
          text: "Fewer than 5 < 6, more > 2",
          url: "https://a.test/",
        },
      ],
    };

    expect(parsePostSource(formatPostSource(body))).toEqual({ ok: true, body });
  });
});
