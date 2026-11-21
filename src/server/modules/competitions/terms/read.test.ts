import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { getRegistrationTerms } from "./read";
import { publishDocument, signInManager } from "./testing";

describe("the public read model's terms", () => {
  it("shows a visitor the fees, prizes and links to the pinned document versions", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id, slug } = await h.seed.competition({
      status: "published",
      participation: "both",
    });
    const terms = await publishDocument(h, "competition_terms", "v1");
    await h.as(manager).setCompetitionFees({
      competitionId: id,
      fees: { individual: "0", institution: "25000.50" },
      currency: "INR",
    });
    await h.as(manager).setRoundAwards({
      competitionId: id,
      roundKey: "foa_final",
      scheme: "medals_gsb",
      prizes: { gold: "A trophy and art supplies" },
    });
    await h
      .as(manager)
      .attachConsentDocument({ competitionId: id, purpose: "competition_terms" });
    await publishDocument(h, "competition_terms", "v2");

    const published = await h.as(h.visitor()).getPublishedCompetition({ slug });

    expect(published?.terms).toEqual({
      fees: [
        { route: "individual", kind: "free" },
        { route: "institution", kind: "amount", paise: 2500050n },
      ],
      awards: [
        {
          roundKey: "school",
          scheme: "ranked_123",
          bands: [
            { band: "first", prize: null },
            { band: "second", prize: null },
            { band: "third", prize: null },
          ],
        },
        {
          roundKey: "foa_final",
          scheme: "medals_gsb",
          bands: [
            { band: "gold", prize: "A trophy and art supplies" },
            { band: "silver", prize: null },
            { band: "bronze", prize: null },
          ],
        },
      ],
      documents: [
        {
          purpose: "competition_terms",
          title: "Draft competition_terms",
          version: terms.version,
          href: "/documents/competition-terms/1",
        },
      ],
    });
  });

  it("says a fee is not set until the manager sets it", async () => {
    const h = await createHarness();
    const { slug } = await h.seed.competition({
      status: "published",
      participation: "individuals",
    });

    const published = await h.as(h.visitor()).getPublishedCompetition({ slug });

    expect(published?.terms.fees).toEqual([
      { route: "individual", kind: "not_set" },
    ]);
    expect(published?.terms.documents).toEqual([]);
  });

  it("keeps a draft's terms hidden with the draft", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id, slug } = await h.seed.competition({ participation: "both" });
    await h.as(manager).setCompetitionFees({ competitionId: id, free: true });

    expect(
      await h.as(h.visitor()).getPublishedCompetition({ slug })
    ).toBeNull();
  });
});

describe("getRegistrationTerms", () => {
  it("gives registration each route's fee and the pinned documents to agree to", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await h.seed.competition({
      status: "published",
      participation: "individuals",
    });
    const privacy = await publishDocument(h, "privacy_notice");
    await h.as(manager).setCompetitionFees({
      competitionId: id,
      fees: { individual: "21474836.49" },
      currency: "INR",
    });
    await h
      .as(manager)
      .attachConsentDocument({ competitionId: id, purpose: "privacy_notice" });

    expect(await getRegistrationTerms(h.db, id)).toEqual({
      fees: {
        individual: { amountMinor: 2147483649n, currency: "INR" },
        institution: null,
      },
      documents: [
        {
          purpose: "privacy_notice",
          documentId: privacy.id,
          version: 1,
          required: true,
        },
      ],
    });
  });

  it("gives null for a fee not set yet, so registration refuses", async () => {
    const h = await createHarness();
    const { id } = await h.seed.competition({
      status: "published",
      participation: "both",
    });

    expect((await getRegistrationTerms(h.db, id))?.fees).toEqual({
      individual: null,
      institution: null,
    });
  });

  it("is null for a competition that doesn't exist", async () => {
    const h = await createHarness();

    expect(
      await getRegistrationTerms(h.db, "01938a00-0000-7000-8000-0000000000aa")
    ).toBeNull();
  });
});
