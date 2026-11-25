import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { consentCompetition } from "../consent/testing";
import { signedInWith } from "../judging/testing";
import { signInAs } from "../ledger/testing";
import { auctionArtwork } from "./testing";

const source = (share: string) =>
  `## Auction permission\nYou may auction the original for animal welfare.\n\n## Auction proceeds {#auction-proceeds}\nThe creator receives ${share}% of the auction proceeds; Friends of Animals receives the remainder.`;

it("binds creator share to the exact current document acknowledged by the guardian", async () => {
  const h = await createHarness();
  const w = await auctionArtwork(h, true);
  const separate = await consentCompetition(h, { fee: 0n });
  const manager = h.as(w.manager),
    auctioneer = h.as(w.auctioneer),
    guardian = h.as(w.artist.actor);
  const finance = h.as((await signInAs(h)).actor);
  const admin = h.as(
    await signedInWith(h, { role: "staff_admin", scope: { type: "global" } })
  );
  const competitionId = w.competition.id;
  const target = {
    childId: w.childId!,
    competitionId,
    purpose: "auction" as const,
  };
  await expect(
    finance.publishConsentDocument({
      purpose: "auction",
      title: "25% creator share",
      source: source("25"),
    })
  ).rejects.toMatchObject({ code: "forbidden" });
  const v25 = await admin.publishConsentDocument({
    purpose: "auction",
    title: "25% creator share",
    source: source("25"),
  });
  if (!v25.ok) throw new Error("25% document refused");
  expect(
    await finance.setAuctionProceedsPolicy({
      competitionId: separate.id,
      creatorShareBps: 2500,
    })
  ).toMatchObject({ ok: false, error: "policy_document_mismatch" });
  expect(await finance.listAuctionProceedsPolicies()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        competitionId: separate.id,
        creatorShareBps: 0,
      }),
    ])
  );
  expect(
    await manager.attachConsentDocument({ competitionId, purpose: "auction" })
  ).toMatchObject({ ok: true, document: { id: v25.id } });
  expect(
    await finance.setAuctionProceedsPolicy({
      competitionId,
      creatorShareBps: 2500,
    })
  ).toMatchObject({ ok: true });
  expect(
    await guardian.giveChildConsent({ ...target, documentId: v25.id })
  ).toMatchObject({ ok: true });
  expect(
    await finance.setAuctionProceedsPolicy({
      competitionId,
      creatorShareBps: 0,
    })
  ).toMatchObject({ ok: false, error: "policy_document_mismatch" });
  const v0 = await admin.publishConsentDocument({
    purpose: "auction",
    title: "FOA keeps all proceeds",
    source: source("0"),
  });
  if (!v0.ok) throw new Error("Zero document refused");
  expect(
    await manager.attachConsentDocument({ competitionId, purpose: "auction" })
  ).toMatchObject({ ok: true, document: { id: v0.id } });
  // Old economics cannot be offered under the newly pinned document.
  expect(await auctioneer.createLot(w.input())).toMatchObject({
    ok: false,
    reasons: ["auction_consent_missing"],
  });
  expect(
    await finance.setAuctionProceedsPolicy({
      competitionId,
      creatorShareBps: 0,
    })
  ).toMatchObject({ ok: true });
  expect(await auctioneer.createLot(w.input())).toMatchObject({
    ok: false,
    reasons: ["auction_consent_missing"],
  });
  expect(
    await guardian.giveChildConsent({ ...target, documentId: v25.id })
  ).toMatchObject({ ok: false, error: "document_outdated" });
  expect(
    await guardian.giveChildConsent({ ...target, documentId: v0.id })
  ).toMatchObject({ ok: true, changed: true });
  expect(await auctioneer.createLot(w.input())).toMatchObject({ ok: true });
});

it("lets only the adult creator acknowledge a changed document, while an unsettled lot freezes its terms", async () => {
  const h = await createHarness();
  const w = await auctionArtwork(h);
  const manager = h.as(w.manager),
    auctioneer = h.as(w.auctioneer),
    creator = h.as(w.artist.actor);
  const finance = h.as((await signInAs(h)).actor);
  const admin = h.as(
    await signedInWith(h, { role: "staff_admin", scope: { type: "global" } })
  );
  const competitionId = w.competition.id;
  const v25 = await admin.publishConsentDocument({
    purpose: "auction",
    title: "25% creator share",
    source: source("25"),
  });
  if (!v25.ok) throw new Error("Document refused");
  expect(
    await manager.attachConsentDocument({ competitionId, purpose: "auction" })
  ).toMatchObject({ ok: true });
  expect(await auctioneer.createLot(w.input())).toMatchObject({
    ok: false,
    reasons: ["auction_consent_missing"],
  });
  expect(
    await finance.setAuctionProceedsPolicy({
      competitionId,
      creatorShareBps: 2500,
    })
  ).toMatchObject({ ok: true });
  const input = { competitionId, documentId: v25.id };
  await expect(
    h.as(h.visitor()).giveMyAuctionConsent(input)
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await auctioneer.giveMyAuctionConsent(input)).toMatchObject({
    ok: false,
    error: "not_registered",
  });
  expect(await creator.myAuctionConsents()).toMatchObject([
    {
      competitionId,
      onCurrent: false,
      document: { id: v25.id, version: v25.version },
    },
  ]);
  expect(
    await creator.giveMyAuctionConsent({
      ...input,
      documentId: w.competition.guardianDocuments.auction!,
    })
  ).toMatchObject({ ok: false, error: "document_outdated" });
  expect(await creator.giveMyAuctionConsent(input)).toMatchObject({
    ok: true,
    changed: true,
  });
  expect(await creator.giveMyAuctionConsent(input)).toMatchObject({
    ok: true,
    changed: false,
  });
  const lot = await auctioneer.createLot(w.input());
  if (!lot.ok) throw new Error("Current consent not eligible");
  const v0 = await admin.publishConsentDocument({
    purpose: "auction",
    title: "FOA keeps all proceeds",
    source: source("0"),
  });
  if (!v0.ok) throw new Error("Document refused");
  expect(
    await manager.attachConsentDocument({ competitionId, purpose: "auction" })
  ).toMatchObject({ ok: false, error: "auction_active" });
  expect(
    await manager.detachConsentDocument({ competitionId, purpose: "auction" })
  ).toMatchObject({ ok: false, error: "auction_active" });
  expect(
    await finance.setAuctionProceedsPolicy({
      competitionId,
      creatorShareBps: 0,
    })
  ).toMatchObject({ ok: false, error: "policy_document_mismatch" });
  expect(await creator.myAuctionConsents()).toMatchObject([
    { competitionId, onCurrent: true, document: { id: v25.id } },
  ]);
});

it("preserves real legacy default grants but cannot launder an unbound nonzero policy back to zero", async () => {
  const h = await createHarness();
  const w = await auctionArtwork(h);
  const { eq } = await import("drizzle-orm");
  const { competition } = await import("@/server/db/schema");
  const finance = h.as((await signInAs(h)).actor),
    auctioneer = h.as(w.auctioneer);
  const competitionId = w.competition.id;
  expect(await auctioneer.listEligibleArtwork()).toEqual([
    expect.objectContaining({ artworkId: w.artworkId }),
  ]);
  expect(
    await finance.setAuctionProceedsPolicy({
      competitionId,
      creatorShareBps: 2500,
    })
  ).toMatchObject({ ok: false, error: "policy_document_mismatch" });
  // Simulate an unbound share saved by the old implementation. Neither
  // using it nor resetting it can imply new terms on the original grant.
  await h.db
    .update(competition)
    .set({ auctionCreatorShareBps: 2500 })
    .where(eq(competition.id, competitionId));
  expect(await auctioneer.createLot(w.input())).toMatchObject({
    ok: false,
    reasons: ["auction_consent_missing"],
  });
  expect(
    await finance.setAuctionProceedsPolicy({
      competitionId,
      creatorShareBps: 0,
    })
  ).toMatchObject({ ok: false, error: "policy_document_mismatch" });
  const admin = h.as(
    await signedInWith(h, { role: "staff_admin", scope: { type: "global" } })
  );
  expect(
    await admin.previewConsentDocument({
      purpose: "auction",
      source: source("125"),
    })
  ).toMatchObject({
    ok: false,
    error: "invalid_source",
    errors: [{ code: "auction_proceeds_invalid" }],
  });
  expect(
    await admin.publishConsentDocument({
      purpose: "auction",
      title: "Invalid terms",
      source: source("125"),
    })
  ).toMatchObject({ ok: false, error: "invalid_source" });
});
