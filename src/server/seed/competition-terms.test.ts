import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  competitionAwardScheme,
  competitionConsentDocument,
  competitionFee,
  consentDocument,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

async function counts(h: Harness) {
  const tables = {
    documents: consentDocument,
    fees: competitionFee,
    awards: competitionAwardScheme,
    pins: competitionConsentDocument,
  };
  const result: Record<string, number | undefined> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await h.db.select({ n: count() }).from(table);
    result[name] = row?.n;
  }
  return result;
}

describe("the competition terms seed", () => {
  it("gives previews a paid and a free competition with terms attached", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const visitor = h.visitor();

    const paid = await h
      .as(visitor)
      .getPublishedCompetition({ slug: "neighbours-on-my-street" });
    const free = await h
      .as(visitor)
      .getPublishedCompetition({ slug: "a-bowl-of-water" });

    expect(paid?.terms.fees).toEqual([
      { route: "individual", kind: "amount", paise: 10_000n },
      { route: "institution", kind: "amount", paise: 100_000n },
    ]);
    expect(paid?.terms.awards[0]).toMatchObject({
      roundKey: "school",
      scheme: "medals_gsb",
    });
    expect(free?.terms.fees).toEqual([{ route: "individual", kind: "free" }]);
    for (const competition of [paid, free]) {
      expect(competition?.terms.documents).toEqual([
        {
          purpose: "competition_terms",
          title: "Competition terms (draft)",
          version: 1,
          href: "/documents/competition-terms/1",
        },
        {
          purpose: "privacy_notice",
          title: "Privacy policy",
          version: 1,
          href: "/documents/privacy-notice/1",
        },
        {
          purpose: "participation",
          title: "Consent for your child to take part",
          version: 1,
          href: "/documents/participation/1",
        },
        {
          purpose: "public_display",
          title: "Consent to show artwork in public",
          version: 1,
          href: "/documents/public-display/1",
        },
        {
          purpose: "social_media",
          title: "Consent to share artwork on social media",
          version: 1,
          href: "/documents/social-media/1",
        },
        {
          purpose: "auction",
          title: "Consent to auction artwork",
          version: 1,
          href: "/documents/auction/1",
        },
      ]);
    }
  });

  it("says its competition terms are a draft", async () => {
    const h = await createHarness();
    await h.seed.preview();

    const terms = await h.as(h.visitor()).getCompetitionDocumentVersion({
      purpose: "competition_terms",
      version: 1,
    });

    expect(JSON.stringify(terms?.body)).toContain(
      "not Friends of Animals' terms"
    );
  });

  it("changes nothing when run again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const once = await counts(h);

    await h.seed.preview();

    expect(await counts(h)).toEqual(once);
    // Three sample fees, and TREES27's free institution fee from the
    // school-route submissions seed (#87). AUCT27 pins auction consent (#131).
    expect(once).toMatchObject({ fees: 4, awards: 1, pins: 13 });
  });
});
