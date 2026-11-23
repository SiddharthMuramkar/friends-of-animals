import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { consentEvent, participantProfile } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { adultForm } from "@/server/modules/participants/testing";
import { createHarness } from "@/test/harness";

import { publicUse } from "./index";

import {
  childForm,
  consentCompetition,
  guardianWithChild,
  publishNextVersion,
  reattach,
} from "./testing";

// #82: a guardian sees each child's full consent history, and a preview of
// how the child is credited in public as their consents stand.

describe("childConsentHistory", () => {
  it("lists every event for the child across competitions, newest first, with what each named", async () => {
    const h = await createHarness();
    const art = await consentCompetition(h, { name: "Art for Animals" });
    const water = await consentCompetition(h, { name: "Water for Strays" });
    const communications = await publishNextVersion(
      h,
      "communications",
      "Messages about your child"
    );
    const child = await guardianWithChild(h, art);
    const registered = await h
      .as(child.actor)
      .registerAsIndividual(childForm(water, child.childId));
    expect(registered.ok).toBe(true);
    const at = (minutes: number) => {
      h.clock.advance({ minutes });
      return h.clock.now();
    };

    const t1 = at(1);
    await h.as(child.actor).giveChildConsent({
      childId: child.childId,
      competitionId: art.id,
      purpose: "public_display",
      documentId: art.guardianDocuments.public_display!,
    });
    const t2 = at(1);
    await h.as(child.actor).giveChildConsent({
      childId: child.childId,
      competitionId: water.id,
      purpose: "participation",
      documentId: water.guardianDocuments.participation!,
    });
    const t3 = at(1);
    await h.as(child.actor).giveChildConsent({
      childId: child.childId,
      purpose: "communications",
      documentId: communications.id,
    });
    const t4 = at(1);
    await h.as(child.actor).withdrawChildConsent({
      childId: child.childId,
      competitionId: art.id,
      purpose: "public_display",
    });

    const history = await h
      .as(child.actor)
      .childConsentHistory({ childId: child.childId });

    const giver = "Test Guardian 1";
    expect(history).toEqual({
      ok: true,
      child: { id: child.childId, fullName: "Asha Kulkarni" },
      events: [
        {
          id: expect.any(String),
          purpose: "public_display",
          competition: { id: art.id, title: "Art for Animals" },
          action: "withdrawn",
          document: {
            id: art.guardianDocuments.public_display,
            version: 1,
            title: "Draft public_display",
          },
          giverName: giver,
          method: "web_form",
          occurredAt: t4,
        },
        {
          id: expect.any(String),
          purpose: "communications",
          competition: null,
          action: "given",
          document: {
            id: communications.id,
            version: 1,
            title: "Messages about your child",
          },
          giverName: giver,
          method: "web_form",
          occurredAt: t3,
        },
        {
          id: expect.any(String),
          purpose: "participation",
          competition: { id: water.id, title: "Water for Strays" },
          action: "given",
          document: {
            id: water.guardianDocuments.participation,
            version: 1,
            title: "Draft participation",
          },
          giverName: giver,
          method: "web_form",
          occurredAt: t2,
        },
        {
          id: expect.any(String),
          purpose: "public_display",
          competition: { id: art.id, title: "Art for Animals" },
          action: "given",
          document: {
            id: art.guardianDocuments.public_display,
            version: 1,
            title: "Draft public_display",
          },
          giverName: giver,
          method: "web_form",
          occurredAt: t1,
        },
      ],
    });
  });

  it("is empty before any consent", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const child = await guardianWithChild(h, competition);

    expect(
      await h.as(child.actor).childConsentHistory({ childId: child.childId })
    ).toMatchObject({ ok: true, events: [] });
  });

  it("lists same-instant changes across purposes in append order", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const { actor, childId } = await guardianWithChild(h, competition);
    const guardian = h.as(actor);
    const scope = { childId, competitionId: competition.id };
    const documentId = competition.guardianDocuments.public_display!;
    const occurredAt = h.clock.now();

    expect(
      await guardian.giveChildConsent({
        ...scope,
        purpose: "public_display",
        documentId,
      })
    ).toEqual({ ok: true, changed: true });
    expect(
      await guardian.withdrawChildConsent({
        ...scope,
        purpose: "public_display",
      })
    ).toEqual({ ok: true, changed: true });
    expect(
      await guardian.giveChildConsent({
        ...scope,
        purpose: "display_city",
        documentId,
      })
    ).toEqual({ ok: true, changed: true });

    const history = await guardian.childConsentHistory({ childId });
    if (!history.ok) throw new Error(history.error);
    expect(
      history.events.map(({ purpose, action, occurredAt }) => ({
        purpose,
        action,
        occurredAt,
      }))
    ).toEqual([
      { purpose: "display_city", action: "given", occurredAt },
      { purpose: "public_display", action: "withdrawn", occurredAt },
      { purpose: "public_display", action: "given", occurredAt },
    ]);
  });
});

describe("childConsents' credit preview", () => {
  it("keeps historical guardian consent withdrawable and refuses new guardian consent for an adult entry", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const fullName = "Riya Kavya Rao";
    const entrant = await h.seed.member({ name: fullName });
    const family = await h.seed.guardian({
      children: [{ fullName, age: 18, loginUserId: entrant.id }],
    });
    const childId = family.childIds[0]!;
    const guardian = h.as(await h.signIn(family.account));
    const registrant = h.as(await h.signIn(entrant));
    expect(
      await registrant.registerAsIndividual(
        adultForm(competition, {
          consents: competition.documents.slice(0, 2),
        })
      )
    ).toMatchObject({ ok: true, status: "pending_payment" });
    const scope = { childId, competitionId: competition.id };
    const purpose = "public_display" as const;
    const documentId = competition.guardianDocuments.public_display!;

    expect(
      await guardian.giveChildConsent({ ...scope, purpose, documentId })
    ).toEqual({ ok: false, error: "purpose_not_offered" });

    // A historical event from when guardian grants were accepted for adults.
    const now = h.clock.now();
    await h.db.insert(consentEvent).values({
      id: uuidv7(now),
      subjectType: "participant_profile",
      subjectId: childId,
      giverUserId: family.account.id,
      competitionId: competition.id,
      purpose,
      documentId,
      action: "given",
      method: "web_form",
      occurredAt: now,
    });
    expect(await guardian.childConsents({ childId })).toMatchObject({
      ok: true,
      competitions: [
        {
          id: competition.id,
          purposes: expect.arrayContaining([
            expect.objectContaining({
              purpose,
              offered: false,
              counts: false,
              state: expect.objectContaining({ status: "given" }),
            }),
          ]),
          creditPreview: { gallery: null },
        },
      ],
    });
    expect(await guardian.withdrawChildConsent({ ...scope, purpose })).toEqual({
      ok: true,
      changed: true,
    });
  });

  it("credits an adult's full name only for the competition and use the entrant authorized", async () => {
    const h = await createHarness();
    const fullName = "Riya Kavya Rao";
    const entrant = await h.seed.member({ name: fullName });
    const family = await h.seed.guardian({
      children: [{ fullName, age: 18, loginUserId: entrant.id }],
    });
    const childId = family.childIds[0]!;
    const registrant = h.as(await h.signIn(entrant));
    const accepted = await consentCompetition(h, { name: "Adult exhibition" });
    const declined = await consentCompetition(h, {
      name: "Private competition",
    });
    const purpose = "public_display" as const;
    expect(
      await registrant.individualRegistrationForm({
        competitionSlug: accepted.slug,
      })
    ).toMatchObject({
      documents: expect.arrayContaining([
        expect.objectContaining({
          purpose,
          documentId: accepted.guardianDocuments[purpose],
          required: false,
        }),
      ]),
    });
    for (const [competition, optedIn] of [
      [accepted, true],
      [declined, false],
    ] as const) {
      const {
        fullName: _name,
        dateOfBirth: _dob,
        ...form
      } = adultForm(competition, {
        consents: optedIn
          ? [
              ...competition.documents.slice(0, 2),
              competition.guardianDocuments[purpose]!,
            ]
          : competition.documents.slice(0, 2),
      });
      expect(await registrant.registerAsIndividual(form)).toMatchObject({
        ok: true,
      });
    }

    const now = h.clock.now();
    // Previously recorded guardian consent cannot authorize this adult.
    await h.db.insert(consentEvent).values({
      id: uuidv7(now),
      subjectType: "participant_profile",
      subjectId: childId,
      giverUserId: family.account.id,
      competitionId: declined.id,
      purpose,
      documentId: declined.guardianDocuments[purpose]!,
      action: "given",
      method: "web_form",
      occurredAt: now,
    });
    const credit = (
      competitionId: string,
      use: "gallery" | "social_media" = "gallery"
    ) => publicUse(h.deps, { profileId: childId, competitionId, use });
    expect(await credit(declined.id)).toBeNull();
    expect(await credit(accepted.id)).toEqual({ name: fullName });
    expect(await credit(accepted.id, "social_media")).toBeNull();
    const guardian = h.as(await h.signIn(family.account));
    expect(
      await guardian.withdrawChildConsent({
        childId,
        competitionId: accepted.id,
        purpose,
      })
    ).toEqual({ ok: true, changed: false });
    expect(await credit(accepted.id)).toEqual({ name: fullName });
    const v2 = await publishNextVersion(h, purpose);
    await reattach(h, accepted.id, purpose, v2.id);
    expect(await credit(accepted.id)).toBeNull();
  });

  it("gives publication callers only the credit allowed on the pinned version", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const child = await guardianWithChild(h, competition, { age: 17 });
    const galleryCredit = () =>
      publicUse(h.deps, {
        profileId: child.childId,
        competitionId: competition.id,
        use: "gallery",
      });

    expect(await galleryCredit()).toBeNull();
    await h.as(child.actor).giveChildConsent({
      childId: child.childId,
      competitionId: competition.id,
      purpose: "public_display",
      documentId: competition.guardianDocuments.public_display!,
    });
    expect(await galleryCredit()).toEqual({ name: "Asha K." });

    h.clock.set("2027-12-15T18:30:00.000Z");
    expect(await galleryCredit()).toEqual({ name: "Asha K." });
    const next = await publishNextVersion(h, "public_display");
    expect(await galleryCredit()).toEqual({ name: "Asha K." });
    await reattach(h, competition.id, "public_display", next.id);
    expect(await galleryCredit()).toBeNull();
  });

  it("follows the consents: nothing, then first name and initial, then the opted-in fields", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const child = await guardianWithChild(h, competition);
    await h.db
      .update(participantProfile)
      .set({ schoolName: "Green Valley School", city: "Pune" })
      .where(eq(participantProfile.id, child.childId));
    const give = (purpose: "public_display" | "display_city" | "auction") =>
      h.as(child.actor).giveChildConsent({
        childId: child.childId,
        competitionId: competition.id,
        purpose,
        documentId:
          purpose === "auction"
            ? competition.guardianDocuments.auction!
            : competition.guardianDocuments.public_display!,
      });
    const preview = async () => {
      const view = await h
        .as(child.actor)
        .childConsents({ childId: child.childId });
      if (!view.ok) throw new Error(view.error);
      return view.competitions[0]?.creditPreview;
    };

    expect(await preview()).toEqual({
      gallery: null,
      results: null,
      social_media: null,
      auction: null,
    });
    await give("public_display");
    expect((await preview())?.gallery).toEqual({ name: "Asha K." });
    await give("display_city");
    await give("auction");
    expect(await preview()).toEqual({
      gallery: { name: "Asha K.", city: "Pune" },
      results: { name: "Asha K.", city: "Pune" },
      social_media: null,
      auction: { name: "Asha K." },
    });
  });

  it("lists each purpose with the version giving it would agree to, and its title", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h, {
      name: "Art for Animals",
      auctionPermitted: false,
    });
    const communications = await publishNextVersion(h, "communications");
    const child = await guardianWithChild(h, competition);

    const view = await h
      .as(child.actor)
      .childConsents({ childId: child.childId });

    expect(view).toMatchObject({
      ok: true,
      child: { id: child.childId, fullName: "Asha Kulkarni" },
      competitions: [
        {
          id: competition.id,
          title: "Art for Animals",
          purposes: [
            {
              purpose: "participation",
              offered: true,
              document: {
                id: competition.guardianDocuments.participation,
                version: 1,
                title: "Draft participation",
              },
              state: { status: "never" },
              counts: false,
            },
            { purpose: "public_display", offered: true },
            { purpose: "display_school", offered: true },
            { purpose: "display_city", offered: true },
            { purpose: "social_media", offered: true },
            { purpose: "auction", offered: false, document: null },
          ],
        },
      ],
      communications: {
        document: { id: communications.id, version: 1 },
        state: { status: "never" },
        counts: false,
      },
    });
  });
});
