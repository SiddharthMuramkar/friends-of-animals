import { describe, expect, it } from "vitest";

import { LEGAL_DOCS, type LegalDoc } from "@/content/legal";

import {
  parseConsentDocumentBody,
  toConsentDocumentBody,
  type ConsentDocumentBody,
} from "./document-body";

const VALID: ConsentDocumentBody = {
  short: [["We send news only if you say yes."]],
  sections: [
    {
      id: "what-we-send",
      title: "What we send",
      blocks: [
        {
          p: [
            "News about ",
            { strong: "competitions" },
            ". Read the ",
            { link: "privacy notice", href: "/privacy" },
            " or write to ",
            { fact: "email" },
            ".",
          ],
        },
        { list: [["Results"], ["Events"]] },
      ],
    },
  ],
};

function withSection(
  patch: Partial<ConsentDocumentBody["sections"][number]>
): unknown {
  return { ...VALID, sections: [{ ...VALID.sections[0]!, ...patch }] };
}

function withInline(inline: unknown): unknown {
  return withSection({ blocks: [{ p: [inline] }] } as never);
}

describe("parseConsentDocumentBody", () => {
  it("returns a valid body unchanged", () => {
    expect(parseConsentDocumentBody(VALID)).toEqual({ ok: true, body: VALID });
  });

  it.each(Object.entries(LEGAL_DOCS))(
    "accepts the %s policy as a published version holds it",
    (_name, doc) => {
      const body = toConsentDocumentBody(doc);
      expect(parseConsentDocumentBody(body)).toEqual({ ok: true, body });
    }
  );

  it("accepts a document with no short version", () => {
    expect(parseConsentDocumentBody({ ...VALID, short: [] }).ok).toBe(true);
  });

  it.each([
    ["not an object", "privacy"],
    ["no sections", { short: [], sections: [] }],
    ["a section with no blocks", withSection({ blocks: [] })],
    ["a section with a blank title", withSection({ title: "  " })],
    ["a section id with capitals", withSection({ id: "What-we-send" })],
    ["a section id with digits", withSection({ id: "part-2" })],
    ["a section id with a trailing hyphen", withSection({ id: "part-" })],
    [
      "two sections with one id",
      { ...VALID, sections: [VALID.sections[0], VALID.sections[0]] },
    ],
    ["an empty paragraph", withSection({ blocks: [{ p: [] }] })],
    ["an empty list", withSection({ blocks: [{ list: [] }] })],
    ["an empty list item", withSection({ blocks: [{ list: [[]] }] })],
    ["an empty string", withInline("")],
    ["empty strong text", withInline({ strong: "" })],
    ["an unknown fact", withInline({ fact: "bankAccount" })],
    ["an unknown inline", withInline({ html: "<b>hi</b>" })],
    // A published version holds its words as agreed: whether production
    // shows a clause is settled before publishing, not when a page renders.
    ["a clause", withInline({ clause: ["Write to ", { fact: "email" }] })],
    [
      "a block of unknown kind",
      withSection({ blocks: [{ html: "x" }] } as never),
    ],
    ["an extra key", { ...VALID, updated: "2026-11-18" }],
  ])("rejects %s", (_name, body) => {
    expect(parseConsentDocumentBody(body).ok).toBe(false);
  });

  it.each([
    "/privacy",
    "/",
    "#what-we-send",
    "https://support.apple.com/105082",
  ])("accepts a link to %s", (href) => {
    expect(parseConsentDocumentBody(withInline({ link: "x", href })).ok).toBe(
      true
    );
  });

  it.each([
    "javascript:alert(1)",
    "//evil.example/path",
    "http://example.test",
    "mailto:someone@example.test",
    "privacy",
    "/a path",
    "",
  ])("rejects a link to %j", (href) => {
    expect(parseConsentDocumentBody(withInline({ link: "x", href })).ok).toBe(
      false
    );
  });
});

describe("toConsentDocumentBody", () => {
  const POLICY: LegalDoc = {
    updated: "2026-11-18",
    short: [
      [
        "Friends of Animals",
        { clause: [" (registered name: ", { fact: "legalName" }, ")"] },
        " runs this site.",
      ],
    ],
    sections: [
      {
        id: "contact",
        title: "Contact",
        blocks: [
          {
            p: [
              {
                clause: ["Write to our officer."],
                needs: ["grievanceOfficerEmail"],
                otherwise: ["Our officer handles requests."],
              },
              " We reply in 30 days.",
            ],
          },
          { list: [[{ clause: ["Post: ", { fact: "address" }] }]] },
        ],
      },
    ],
  };

  it("keeps every clause's words and facts, and joins neighbouring words", () => {
    expect(toConsentDocumentBody(POLICY)).toEqual({
      short: [
        [
          "Friends of Animals (registered name: ",
          { fact: "legalName" },
          ") runs this site.",
        ],
      ],
      sections: [
        {
          id: "contact",
          title: "Contact",
          blocks: [
            { p: ["Write to our officer. We reply in 30 days."] },
            { list: [["Post: ", { fact: "address" }]] },
          ],
        },
      ],
    });
  });

  it("keeps the policy's date out: a version has its own publication time", () => {
    expect(toConsentDocumentBody(POLICY)).not.toHaveProperty("updated");
  });
});
