import { describe, expect, it, vi } from "vitest";

import { legalKind } from "@/server/modules/cms/kinds/legal";
import { renderHtml } from "@/test/render";

import { LegalSectionsText } from "./legal-text";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

/** A policy page body as a content manager saves it in the CMS (#111). */
const CMS_BODY = {
  short: [["We keep children safe."]],
  sections: [
    {
      id: "staying-safe-online",
      title: "Staying safe online",
      blocks: [
        {
          p: [
            "Clear your history with ",
            {
              link: "Chrome's help",
              href: "https://support.google.com/chrome/answer/95589",
            },
            ", or read our ",
            {
              link: "child protection policy",
              href: "/child-protection-policy",
            },
            ".",
          ],
        },
      ],
    },
  ],
};

/** Each <a> start tag in `html`, by its href. */
function anchors(html: string): Map<string, string> {
  return new Map(
    [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => [
      /\shref="([^"]*)"/.exec(tag)?.[1] ?? "",
      tag,
    ])
  );
}

describe("a link in a CMS policy body", () => {
  it("to another site can't reach back, send a referrer or pass rank", async () => {
    const html = await renderHtml(
      <LegalSectionsText
        sections={legalKind.sanitize(CMS_BODY).sections}
        level="h2"
      />
    );

    expect(
      anchors(html).get("https://support.google.com/chrome/answer/95589")
    ).toContain(' rel="noopener noreferrer nofollow"');
  });

  it("to a page on this site has no rel", async () => {
    const html = await renderHtml(
      <LegalSectionsText
        sections={legalKind.sanitize(CMS_BODY).sections}
        level="h2"
      />
    );

    const internal = anchors(html).get("/child-protection-policy");
    expect(internal).toBeDefined();
    expect(internal).not.toContain(" rel=");
  });
});
