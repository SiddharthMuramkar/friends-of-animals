import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { competitionConsentDocument, consentEvent } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  SEED_TERMS_COMPETITIONS,
  seedCompetitionTerms,
} from "./competition-terms";
import { seedAuctions } from "./auctions";
import { seedCompetitions } from "./competitions";
import { seedConsent } from "./consent";
import { SEED_GUARDIANS, seedGuardians } from "./guardians";

async function signedInGuardian(h: Harness) {
  return h.signIn(SEED_GUARDIANS.guardian, undefined, { secondFactor: false });
}

/** Each purpose's status for the child in NEIGH27, and communications. */
async function statuses(h: Harness, childId: string) {
  const view = await h.as(await signedInGuardian(h)).childConsents({ childId });
  if (!view.ok) throw new Error(view.error);
  const neighbours = view.competitions.find(
    (competition) => competition.id === SEED_TERMS_COMPETITIONS.paid
  );
  return {
    ...Object.fromEntries(
      (neighbours?.purposes ?? []).map((each) => [
        each.purpose,
        each.state.status,
      ])
    ),
    communications: view.communications.state.status,
    credit: neighbours?.creditPreview.gallery ?? null,
  };
}

describe("the guardian consents seed (#82)", () => {
  it("attaches draft guardian documents to the seeded competitions", async () => {
    const h = await createHarness();
    await h.seed.preview();

    const attached = await h.db
      .select({ purpose: competitionConsentDocument.purpose })
      .from(competitionConsentDocument)
      .where(
        eq(
          competitionConsentDocument.competitionId,
          SEED_TERMS_COMPETITIONS.paid
        )
      )
      .orderBy(asc(competitionConsentDocument.purpose));
    expect(attached.map((row) => row.purpose).sort()).toEqual(
      [
        "auction",
        "competition_terms",
        "participation",
        "privacy_notice",
        "public_display",
        "social_media",
      ].sort()
    );
  });

  it("gives the under-13 child participation, public display and city, never school; and communications", async () => {
    const h = await createHarness();
    await h.seed.preview();

    expect(await statuses(h, SEED_GUARDIANS.children.young.profileId)).toEqual({
      participation: "given",
      public_display: "given",
      display_school: "never",
      display_city: "given",
      social_media: "never",
      auction: "never",
      communications: "given",
      credit: { name: "Isha D.", city: "Pune" },
    });
  });

  it("gives the linked teen participation and social media, and public display given then withdrawn", async () => {
    const h = await createHarness();
    await h.seed.preview();

    expect(await statuses(h, SEED_GUARDIANS.children.teen.profileId)).toEqual({
      participation: "given",
      public_display: "withdrawn",
      display_school: "never",
      display_city: "never",
      social_media: "given",
      auction: "never",
      communications: "never",
      credit: null,
    });
    // Participation given: both children's places wait for payment.
    const registrations = await h
      .as(await signedInGuardian(h))
      .listMyRegistrations();
    expect(
      registrations
        .filter((each) => each.competition.slug === "neighbours-on-my-street")
        .map((each) => [each.participantName, each.status])
    ).toEqual(
      expect.arrayContaining([
        [SEED_GUARDIANS.children.young.fullName, "pending_payment"],
        [SEED_GUARDIANS.children.teen.fullName, "pending_payment"],
      ])
    );
  });

  it("is safe to run again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const before = await h.db.select().from(consentEvent);

    await h.seed.preview();

    expect(await h.db.select().from(consentEvent)).toEqual(before);
  });

  it("keeps existing communications consent and seeds the registration on hold across reruns", async () => {
    const h = await createHarness();
    await seedCompetitions(h.deps);
    await seedConsent(h.deps);
    await seedCompetitionTerms(h.deps);
    await seedGuardians(h.deps);
    const child = SEED_GUARDIANS.children.young;
    const guardian = h.as(await signedInGuardian(h));
    const view = await guardian.childConsents({ childId: child.profileId });
    if (!view.ok || !view.communications.document)
      throw new Error("No communications document");
    expect(
      await guardian.giveChildConsent({
        childId: child.profileId,
        purpose: "communications",
        documentId: view.communications.document.id,
      })
    ).toEqual({ ok: true, changed: true });
    await seedAuctions(h.deps);
    const history = await guardian.childConsentHistory({
      childId: child.profileId,
    });

    for (let run = 0; run < 2; run++) {
      await h.seed.preview();

      const registrations = await guardian.listMyRegistrations();
      expect(
        registrations.filter((each) => each.participantName === child.fullName)
      ).toMatchObject([
        { status: "pending_guardian", heldFor: "consent" },
        { status: "confirmed", competition: { slug: "art-for-kindness" } },
        { status: "confirmed", competition: { slug: "originals-for-animals" } },
      ]);
      expect(
        await guardian.childConsentHistory({ childId: child.profileId })
      ).toEqual(history);
    }
  });
});
