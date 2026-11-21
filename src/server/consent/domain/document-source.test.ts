import { describe, expect, it } from "vitest";

import { LEGAL_DOCS } from "@/content/legal";

import type { ConsentDocumentBody } from "./document-body";
import {
  formatConsentDocumentSource,
  parseConsentDocumentSource,
} from "./document-source";

const source = (...lines: string[]) => lines.join("\n");

describe("parseConsentDocumentSource", () => {
  it("reads short points, sections, paragraphs, lists and inline marks", () => {
    const text = source(
      "- We send news only if you say **yes**.",
      "- You can stop at any time.",
      "",
      "## What we send",
      "News about competitions",
      "and results.",
      "",
      "- Results",
      "- Events near [you](/events)",
      "",
      "## Stopping {#how-to-stop}",
      "Write to {{email}} or see the [privacy notice](/privacy#rights)."
    );

    expect(parseConsentDocumentSource(text)).toEqual({
      ok: true,
      body: {
        short: [
          ["We send news only if you say ", { strong: "yes" }, "."],
          ["You can stop at any time."],
        ],
        sections: [
          {
            id: "what-we-send",
            title: "What we send",
            blocks: [
              { p: ["News about competitions and results."] },
              {
                list: [
                  ["Results"],
                  ["Events near ", { link: "you", href: "/events" }],
                ],
              },
            ],
          },
          {
            id: "how-to-stop",
            title: "Stopping",
            blocks: [
              {
                p: [
                  "Write to ",
                  { fact: "email" },
                  " or see the ",
                  { link: "privacy notice", href: "/privacy#rights" },
                  ".",
                ],
              },
            ],
          },
        ],
      },
    });
  });

  it("takes backslash-escaped marks as plain text", () => {
    const text = source(
      "## Plain marks",
      "\\- not a list, \\*\\*not strong\\*\\*, \\[not a link\\], \\{\\{not a fact\\}\\}, a \\\\"
    );

    expect(parseConsentDocumentSource(text)).toMatchObject({
      ok: true,
      body: {
        sections: [
          {
            blocks: [
              {
                p: [
                  "- not a list, **not strong**, [not a link], {{not a fact}}, a \\",
                ],
              },
            ],
          },
        ],
      },
    });
  });

  it("starts a new block when a list follows a paragraph directly", () => {
    const result = parseConsentDocumentSource(
      source("## Section", "Intro", "- One", "- Two", "", "- Three")
    );

    expect(result).toMatchObject({
      ok: true,
      body: {
        sections: [
          {
            blocks: [
              { p: ["Intro"] },
              { list: [["One"], ["Two"]] },
              { list: [["Three"]] },
            ],
          },
        ],
      },
    });
  });

  it.each([
    [
      "no sections",
      source("- Just a point"),
      [{ line: null, code: "no_sections" }],
    ],
    [
      "text before the first section",
      source("Hello", "## Section", "Text"),
      [{ line: 1, code: "text_before_first_section" }],
    ],
    [
      "an empty section",
      source("## Empty", "", "## Full", "Text"),
      [{ line: 1, code: "empty_section" }],
    ],
    [
      "a section id that is not kebab-case letters",
      source("## Part {#part-2}", "Text"),
      [{ line: 1, code: "invalid_section_id" }],
    ],
    [
      "a title with no letters for an id",
      source("## 2027", "Text"),
      [{ line: 1, code: "invalid_section_id" }],
    ],
    [
      "two sections with one id",
      source("## Rights", "Text", "## Rights", "More"),
      [{ line: 3, code: "duplicate_section_id" }],
    ],
    [
      "unclosed strong text",
      source("## Section", "This is **loud"),
      [{ line: 2, code: "unclosed_strong" }],
    ],
    [
      "empty strong text",
      source("## Section", "This is ****"),
      [{ line: 2, code: "empty_strong" }],
    ],
    [
      "an unclosed link",
      source("## Section", "See [the notice"),
      [{ line: 2, code: "unclosed_link" }],
    ],
    [
      "a link without an address",
      source("## Section", "See [the notice] here"),
      [{ line: 2, code: "unclosed_link" }],
    ],
    [
      "a link to a disallowed address",
      source("## Section", "", "- See [this](javascript:alert(1))"),
      [{ line: 3, code: "invalid_link" }],
    ],
    [
      "an unknown fact",
      source("## Section", "Our bank is {{bankAccount}}"),
      [{ line: 2, code: "unknown_fact" }],
    ],
    [
      "an unclosed fact",
      source("## Section", "Write to {{email"),
      [{ line: 2, code: "unclosed_fact" }],
    ],
    [
      "a dangling backslash",
      source("## Section", "Ends with \\"),
      [{ line: 2, code: "dangling_escape" }],
    ],
  ])("reports %s with its line", (_name, text, errors) => {
    expect(parseConsentDocumentSource(text)).toEqual({ ok: false, errors });
  });

  it("reports every error, in line order", () => {
    const result = parseConsentDocumentSource(
      source("Intro", "## Section", "**open", "## Section", "Text")
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        { line: 1, code: "text_before_first_section" },
        { line: 3, code: "unclosed_strong" },
        { line: 4, code: "duplicate_section_id" },
      ],
    });
  });

  it("accepts Windows line endings and surrounding blank lines", () => {
    expect(
      parseConsentDocumentSource("\r\n## Section\r\nText\r\n\r\n")
    ).toEqual({
      ok: true,
      body: {
        short: [],
        sections: [
          { id: "section", title: "Section", blocks: [{ p: ["Text"] }] },
        ],
      },
    });
  });
});

describe("formatConsentDocumentSource", () => {
  it("writes a body as the source staff edit", () => {
    const body: ConsentDocumentBody = {
      short: [["Only if you say ", { strong: "yes" }, "."]],
      sections: [
        {
          id: "what-we-send",
          title: "What we send",
          blocks: [
            { p: ["- News, [weekly] *maybe*"] },
            { list: [["Results"], [{ link: "Events", href: "/events" }]] },
          ],
        },
        {
          id: "stop",
          title: "How to stop",
          blocks: [{ p: ["Write to ", { fact: "email" }, "."] }],
        },
      ],
    };

    expect(formatConsentDocumentSource(body)).toBe(
      source(
        "- Only if you say **yes**.",
        "",
        "## What we send",
        "\\- News, \\[weekly\\] \\*maybe\\*",
        "",
        "- Results",
        "- [Events](/events)",
        "",
        "## How to stop {#stop}",
        "Write to {{email}}.",
        ""
      )
    );
  });

  it.each(Object.entries(LEGAL_DOCS))(
    "round-trips the %s policy unchanged",
    (_name, doc) => {
      const body = { short: doc.short, sections: doc.sections };

      expect(
        parseConsentDocumentSource(formatConsentDocumentSource(body))
      ).toEqual({ ok: true, body });
    }
  );
});
