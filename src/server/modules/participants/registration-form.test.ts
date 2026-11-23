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
      allowsMinorRegistration: true,
      minorRegistrationUnavailable: false,
      registrant: { kind: "own", children: [] },
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

  describe("who is registering (#81)", () => {
    it("lists a guardian's children to choose from, and names the one chosen", async () => {
      const h = await createHarness();
      const competition = await openToIndividuals(h);
      const family = await h.seed.guardian({
        children: [
          { fullName: "Isha Desai", age: 9 },
          { fullName: "Rohan Desai", age: 15 },
        ],
      });
      const parent = await h.signIn(family.account);

      expect(
        await h
          .as(parent)
          .individualRegistrationForm({ competitionSlug: competition.slug })
      ).toMatchObject({
        registrant: {
          kind: "own",
          children: [
            { id: family.childIds[0], fullName: "Isha Desai" },
            { id: family.childIds[1], fullName: "Rohan Desai" },
          ],
        },
      });
      expect(
        await h.as(parent).individualRegistrationForm({
          competitionSlug: competition.slug,
          forChildId: family.childIds[1]!,
        })
      ).toMatchObject({
        registrant: {
          kind: "child",
          childId: family.childIds[1],
          fullName: "Rohan Desai",
          dateOfBirth: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
        documents: expect.arrayContaining([
          {
            purpose: "participation",
            documentId: competition.guardianDocuments.participation,
            title: "Draft participation",
            version: 1,
            href: "/documents/participation/1",
            required: false,
          },
        ]),
      });
    });

    it("gives a linked teen their own child profile's name and date of birth", async () => {
      const h = await createHarness();
      const competition = await openToIndividuals(h);
      const teen = await h.seed.member();
      await h.seed.guardian({
        children: [{ fullName: "Rohan Desai", age: 15, loginUserId: teen.id }],
      });

      expect(
        await h
          .as(await h.signIn(teen))
          .individualRegistrationForm({ competitionSlug: competition.slug })
      ).toMatchObject({
        registrant: { kind: "linked", fullName: "Rohan Desai" },
        documents: [
          expect.objectContaining({
            purpose: "competition_terms",
            required: true,
          }),
          expect.objectContaining({
            purpose: "privacy_notice",
            required: true,
          }),
        ],
      });
    });

    it("refuses naming somebody else's child", async () => {
      const h = await createHarness();
      const competition = await openToIndividuals(h);
      const family = await h.seed.guardian({
        children: [{ fullName: "Isha Desai", age: 9 }],
      });
      const member = await signInMember(h);

      await expect(
        h.as(member.actor).individualRegistrationForm({
          competitionSlug: competition.slug,
          forChildId: family.childIds[0]!,
        })
      ).rejects.toThrow(DomainError);
    });
  });
});
