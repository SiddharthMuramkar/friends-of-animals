import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import { openToIndividuals, signInMember } from "./testing";

describe("individualRegistrationForm", () => {
  it("shows the fee and the pinned documents a registrant agrees to, by id", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h, { name: "Paws on Paper" });
    const member = await signInMember(h);

    expect(
      await h
        .as(member.actor)
        .individualRegistrationForm({ competitionSlug: competition.slug })
    ).toEqual({
      competition: { name: "Paws on Paper", slug: competition.slug },
      acceptsIndividuals: true,
      fee: { amountMinor: 25_000n, currency: "INR" },
      documents: [
        {
          documentId: competition.documents[0],
          purpose: "competition_terms",
          title: "Draft competition_terms",
          version: 1,
          href: "/documents/competition-terms/1",
          required: true,
        },
        {
          documentId: competition.documents[1],
          purpose: "privacy_notice",
          title: "Draft privacy_notice",
          version: 1,
          href: "/documents/privacy-notice/1",
          required: true,
        },
      ],
    });
  });

  it("finds no draft and no unknown competition", async () => {
    const h = await createHarness();
    const draft = await openToIndividuals(h, { status: "draft" });
    const member = await signInMember(h);

    for (const competitionSlug of [draft.slug, "no-such-one", "Not A Slug!"]) {
      expect(
        await h.as(member.actor).individualRegistrationForm({ competitionSlug })
      ).toBeNull();
    }
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);

    await expect(
      h
        .as(h.visitor())
        .individualRegistrationForm({ competitionSlug: competition.slug })
    ).rejects.toThrow(DomainError);
  });
});
