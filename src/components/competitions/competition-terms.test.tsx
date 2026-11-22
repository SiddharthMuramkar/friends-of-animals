import { describe, expect, it, vi } from "vitest";

import { renderHtml, visibleText } from "@/test/render";

import { CompetitionTerms } from "./competition-terms";
import type { CompetitionTermsView } from "./model";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

const TERMS: CompetitionTermsView = {
  fees: [
    { route: "institution", kind: "amount", paise: "2147483649" },
    { route: "individual", kind: "free" },
  ],
  awards: [
    {
      roundKey: "school",
      scheme: "medals_gsb",
      bands: [
        { band: "gold", prize: "A trophy" },
        { band: "silver", prize: null },
        { band: "bronze", prize: null },
      ],
    },
  ],
  documents: [
    {
      purpose: "competition_terms",
      title: "Competition terms",
      version: 2,
      href: "/documents/competition-terms/2",
    },
  ],
};

// The public competition page's fees, prizes and the exact document
// versions registering agrees to (#72).
describe("<CompetitionTerms>", () => {
  it("shows each route's fee exactly, the prizes per round, and links to the pinned versions", async () => {
    const html = await renderHtml(<CompetitionTerms terms={TERMS} />);
    const text = visibleText(html);

    expect(html).toMatch(
      /<dt\b[^>]*>Entering through a school or institution<\/dt><dd\b[^>]*>₹2,14,74,836\.49<\/dd>/
    );
    expect(html).toMatch(
      /<dt\b[^>]*>Entering on your own<\/dt><dd\b[^>]*>Free<\/dd>/
    );
    expect(text).toContain("School round · Gold, silver and bronze");
    expect(text).toContain("Gold: A trophy");
    expect(text).toContain("Silver: No prize listed");
    expect(html).toMatch(
      /<a\b[^>]*\shref="\/documents\/competition-terms\/2"[^>]*>[\s\S]*Competition terms, version 2<\/a>/
    );
  });

  it("says the terms come later while nothing is attached", async () => {
    const html = await renderHtml(
      <CompetitionTerms terms={{ ...TERMS, documents: [] }} />
    );

    expect(visibleText(html)).toContain(
      "The terms will be linked here before registration opens."
    );
    expect(html).not.toMatch(/href="\/documents\//);
  });
});
