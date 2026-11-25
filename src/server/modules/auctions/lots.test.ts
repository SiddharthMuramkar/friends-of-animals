import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import {
  conditionPhotos,
  verificationDetails,
} from "../physical-artwork/testing";
import {
  submittedIndividualEntry,
  closeSubmissions,
} from "../verification/testing";
import { signedInVerifier } from "../verification/testing";
import { consentCompetition } from "../consent/testing";
import { signedInWith, managerOf } from "../judging/testing";

describe("auction lots", () => {
  it("reserves verified, consented artwork only once, and refuses a competition manager", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h, {
      fee: 0n,
      physicalArtwork: { kind: "all_shortlisted" },
    });
    const artist = await submittedIndividualEntry(h, { competition });
    await closeSubmissions(h);
    const competitionId = artist.competition.id;
    const manager = await signedInWith(h, managerOf(competitionId));
    const verifier = await signedInVerifier(h);
    const auctioneer = await signedInWith(h, {
      role: "auction_manager",
      scope: { type: "global" },
    });
    expect(
      await h.as(verifier).verifyEntry({ entryId: artist.entryId })
    ).toMatchObject({ ok: true });
    const requested = await h
      .as(manager)
      .requestPhysicalArtwork({ competitionId, entryIds: [artist.entryId] });
    if (!requested.ok) throw new Error("Request failed");
    const { artworkId } = requested.artworks[0]!;
    expect(
      await h.as(verifier).markArtworkReceived({ artworkId })
    ).toMatchObject({ ok: true });
    const input = {
      artworkId,
      story: "A celebration of kindness",
      basePricePaise: 10000n,
      reservePricePaise: 15000n,
      opensAt: new Date(h.clock.now().getTime() + 3600000),
      closesAt: new Date(h.clock.now().getTime() + 7200000),
    };
    await expect(h.as(manager).createLot(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await h.as(auctioneer).createLot(input)).toMatchObject({
      ok: false,
      error: "ineligible",
      reasons: ["artwork_not_listable"],
    });
    const photos = await conditionPhotos(h, verifier, artworkId);
    expect(
      await h
        .as(verifier)
        .verifyArtwork({ artworkId, ...verificationDetails, photos })
    ).toMatchObject({ ok: true });
    const created = await h.as(auctioneer).createLot(input);
    expect(created).toMatchObject({
      ok: true,
      lotCode: /^LOT-\d{2}-[0-9A-HJKMNP-TV-Z]{5}$/,
    });
    expect(await h.as(auctioneer).createLot(input)).toMatchObject({
      ok: false,
      error: "ineligible",
      reasons: ["already_listed"],
    });
  });
});

import { eq } from "drizzle-orm";
import { competition, guardianLink } from "@/server/db/schema";
import { SEED_AUCTIONS } from "@/server/seed/auctions";
import { SEED_GUARDIANS } from "@/server/seed/guardians";
import { SEED_AUCTION_COMPETITION } from "@/server/seed/competitions";
import { auctionArtwork } from "./testing";
import { emit } from "@/server/outbox";
import { uuidv7 } from "@/server/ids";

describe("auction lot lifecycle", () => {
  it("keeps a draft private; schedules, opens and settles unsold with original custody restored", async () => {
    const h = await createHarness();
    const w = await auctionArtwork(h);
    const staff = h.as(w.auctioneer),
      artist = h.as(w.artist.actor),
      visitor = h.as(h.visitor()),
      custody = h.as(w.verifier);
    await expect(artist.listEligibleArtwork()).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await staff.listEligibleArtwork()).toEqual([
      expect.objectContaining({ artworkId: w.artworkId }),
    ]);
    const draft = await staff.createLot(w.input());
    if (!draft.ok) throw new Error("Draft refused");
    const ref = { lotId: draft.lotId },
      code = { lotCode: draft.lotCode };
    await expect(artist.listLotsForAdmin()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(artist.getLotForAdmin(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await staff.listLotsForAdmin()).toMatchObject([{ status: "draft" }]);
    expect(await staff.getLotForAdmin(ref)).toMatchObject({
      status: "draft",
      artworkStatusBeforeListing: "verified",
    });
    expect(await visitor.getLot(code)).toBeNull();
    expect(await staff.scheduleLot(ref)).toMatchObject({
      ok: false,
      error: "auctions_disabled",
    });
    await h.settings.set("auctions.enabled", true);
    await expect(artist.scheduleLot(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(staff.openLot(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(staff.closeLot(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(staff.settleClosedLot(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    const worker = h.as({ kind: "system", process: "worker" });
    expect(await staff.scheduleLot(ref)).toMatchObject({
      ok: true,
      status: "scheduled",
    });
    expect(await worker.openLot(ref)).toMatchObject({
      ok: false,
      error: "not_due",
    });
    expect(await visitor.browseLots()).toEqual([
      expect.objectContaining({
        status: "scheduled",
        lotCode: draft.lotCode,
        basePricePaise: 10000n,
      }),
    ]);
    const publicLot = await visitor.getLot(code);
    expect(publicLot).not.toHaveProperty("reservePricePaise");
    expect(publicLot).not.toHaveProperty("artworkId");
    expect(publicLot).not.toHaveProperty("consentEventId");
    expect(
      await h
        .as(w.manager)
        .exhibitArtwork({ artworkId: w.artworkId, location: "Hall" })
    ).toMatchObject({ ok: false, error: "auction_reserved" });
    h.clock.advance({ minutes: 59 });
    await h.drain();
    expect(await staff.getLotForAdmin(ref)).toMatchObject({
      status: "scheduled",
    });
    h.clock.advance({ minutes: 1 });
    await h.drain();
    expect(await staff.getLotForAdmin(ref)).toMatchObject({ status: "open" });
    expect(await staff.scheduleLot(ref)).toMatchObject({
      ok: false,
      error: "transition_not_allowed",
    });
    expect(await worker.closeLot(ref)).toMatchObject({
      ok: false,
      error: "not_due",
    });
    h.clock.advance({ hours: 1 });
    await h.drain();
    expect(await staff.getLotForAdmin(ref)).toMatchObject({ status: "unsold" });
    expect(await visitor.getLot(code)).toBeNull();
    expect(
      await custody.getArtworkCustody({ artworkId: w.artworkId })
    ).toMatchObject({
      status: "verified",
      events: expect.arrayContaining([
        expect.objectContaining({ kind: "auction_reserved" }),
        expect.objectContaining({ kind: "auction_released" }),
      ]),
    });
    expect(await staff.cancelLot({ ...ref, reason: "Changed" })).toMatchObject({
      ok: false,
      error: "transition_not_allowed",
    });
    expect(await staff.listEligibleArtwork()).toHaveLength(1);
  });

  it("sets no guardian credit without verified consent, immediately hides a withdrawal and cancels after draining", async () => {
    const h = await createHarness();
    const w = await auctionArtwork(h, true);
    const manager = h.as(w.auctioneer),
      guardian = h.as(w.artist.actor),
      visitor = h.as(h.visitor());
    expect(await manager.createLot(w.input())).toMatchObject({
      ok: false,
      error: "ineligible",
      reasons: ["auction_consent_missing"],
    });
    const consent = {
      childId: w.childId!,
      competitionId: w.competition.id,
      purpose: "auction" as const,
    };
    expect(
      await guardian.giveChildConsent({
        ...consent,
        documentId: w.competition.guardianDocuments.auction!,
      })
    ).toMatchObject({ ok: true });
    await h.settings.set("auctions.enabled", true);
    const draft = await manager.createLot(w.input());
    if (!draft.ok) throw new Error("Draft refused");
    const ref = { lotId: draft.lotId },
      code = { lotCode: draft.lotCode };
    expect(await manager.getLotForAdmin(ref)).toMatchObject({
      creatorCredit: "Isha D.",
    });
    expect(await manager.scheduleLot(ref)).toMatchObject({ ok: true });
    expect(await visitor.getLot(code)).toMatchObject({
      creatorCredit: "Isha D.",
    });
    expect(await guardian.withdrawChildConsent(consent)).toMatchObject({
      ok: true,
      changed: true,
    });
    // No stale credit even though the worker hasn't drained the event.
    expect(await visitor.getLot(code)).toBeNull();
    expect(await visitor.browseLots()).toEqual([]);
    await h.drain();
    expect(await manager.getLotForAdmin(ref)).toMatchObject({
      status: "cancelled",
      creatorCredit: null,
    });
    expect(
      await h.as(w.verifier).getArtworkCustody({ artworkId: w.artworkId })
    ).toMatchObject({ status: "verified" });
    expect(
      await guardian.giveChildConsent({
        ...consent,
        documentId: w.competition.guardianDocuments.auction!,
      })
    ).toMatchObject({ ok: true });
    // Current consent from a guardian with a revoked link must fail closed.
    await h.db
      .update(guardianLink)
      .set({ revokedAt: h.clock.now() })
      .where(eq(guardianLink.participantProfileId, w.childId!));
    expect(await manager.createLot(w.input())).toMatchObject({
      ok: false,
      error: "ineligible",
      reasons: ["auction_consent_missing"],
    });
  });

  it("releases exhibited and retained originals on cancellation and refuses wrong actors", async () => {
    const h = await createHarness();
    const w = await auctionArtwork(h);
    const staff = h.as(w.auctioneer),
      artist = h.as(w.artist.actor),
      custody = h.as(w.verifier),
      manager = h.as(w.manager);
    const artworkId = w.artworkId;
    expect(
      await manager.exhibitArtwork({ artworkId, location: "Hall" })
    ).toMatchObject({ ok: true });
    const draft = await staff.createLot(w.input());
    if (!draft.ok) throw new Error("Draft refused");
    const cancel = { lotId: draft.lotId, reason: "Exhibition first" };
    await expect(artist.cancelLot(cancel)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await staff.cancelLot(cancel)).toMatchObject({
      ok: true,
      status: "cancelled",
    });
    expect(await custody.getArtworkCustody({ artworkId })).toMatchObject({
      status: "on_exhibition",
    });
    await emit(h.db, h.clock, {
      type: "results.published",
      aggregate: { type: "competition", id: w.competition.id },
      payload: {
        competitionId: w.competition.id,
        releaseId: uuidv7(h.clock.now()),
        publishedAt: h.clock.now().toISOString(),
      },
    });
    await h.drain();
    h.clock.advance({ days: 30 });
    await h.drain();
    expect(await custody.getArtworkCustody({ artworkId })).toMatchObject({
      status: "retained",
    });
    const retained = await staff.createLot(w.input());
    if (!retained.ok) throw new Error("Draft refused");
    expect(
      await staff.cancelLot({ lotId: retained.lotId, reason: "Hold back" })
    ).toMatchObject({ ok: true });
    expect(await custody.getArtworkCustody({ artworkId })).toMatchObject({
      status: "retained",
    });
  });

  it("lets only the adult creator withdraw their own scoped auction consent", async () => {
    const h = await createHarness();
    const w = await auctionArtwork(h);
    const staff = h.as(w.auctioneer),
      artist = h.as(w.artist.actor),
      visitor = h.as(h.visitor());
    const ref = { competitionId: w.competition.id };
    await expect(visitor.myAuctionConsents()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(visitor.withdrawMyAuctionConsent(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await staff.withdrawMyAuctionConsent(ref)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(await artist.myAuctionConsents()).toMatchObject([
      { ...ref, state: "given" },
    ]);
    const draft = await staff.createLot(w.input());
    if (!draft.ok) throw new Error("Draft refused");
    expect(await artist.withdrawMyAuctionConsent(ref)).toMatchObject({
      ok: true,
      changed: true,
    });
    await h.drain();
    expect(await staff.getLotForAdmin({ lotId: draft.lotId })).toMatchObject({
      status: "cancelled",
    });
    expect(await artist.myAuctionConsents()).toMatchObject([
      { ...ref, state: "withdrawn" },
    ]);
    expect(await staff.createLot(w.input())).toMatchObject({
      ok: false,
      error: "ineligible",
      reasons: ["auction_consent_missing"],
    });
  });
});

describe("auction eligibility boundaries", () => {
  it("refuses invalid terms, a disabled competition and an outstanding return request", async () => {
    const h = await createHarness();
    const w = await auctionArtwork(h);
    const staff = h.as(w.auctioneer);
    expect(
      await staff.createLot({ ...w.input(), reservePricePaise: 1n })
    ).toMatchObject({
      ok: false,
      error: "invalid_terms",
      errors: ["reserve_below_base"],
    });
    expect(
      await staff.createLot({ ...w.input(), opensAt: h.clock.now() })
    ).toMatchObject({
      ok: false,
      error: "invalid_terms",
      errors: ["opens_in_past"],
    });
    await h.db
      .update(competition)
      .set({ auctionPermitted: false })
      .where(eq(competition.id, w.competition.id));
    expect(await staff.createLot(w.input())).toMatchObject({
      ok: false,
      error: "ineligible",
      reasons: ["competition_not_auctionable", "auction_consent_missing"],
    });
    await h.db
      .update(competition)
      .set({ auctionPermitted: true })
      .where(eq(competition.id, w.competition.id));
    await emit(h.db, h.clock, {
      type: "results.published",
      aggregate: { type: "competition", id: w.competition.id },
      payload: {
        competitionId: w.competition.id,
        releaseId: uuidv7(h.clock.now()),
        publishedAt: h.clock.now().toISOString(),
      },
    });
    await h.drain();
    expect(
      await h
        .as(w.artist.actor)
        .requestArtworkReturn({ artworkId: w.artworkId })
    ).toMatchObject({ ok: true });
    expect(await staff.createLot(w.input())).toMatchObject({
      ok: false,
      error: "ineligible",
      reasons: ["return_requested"],
    });
    expect(await staff.listEligibleArtwork()).toEqual([]);
  });
  it("a withdrawal cancels only its existing lot even if consent is regranted before the worker runs", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const staff = h.as(await h.signIn(SEED_AUCTIONS.manager));
    const guardian = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    const visitor = h.as(h.visitor());
    const childId = SEED_GUARDIANS.children.teen.profileId;
    const target = {
      childId,
      competitionId: SEED_AUCTION_COMPETITION.id,
      purpose: "auction" as const,
    };
    const before = await guardian.childConsents({ childId });
    if (!before.ok) throw new Error("Guardian not ready");
    const documentId = before.competitions
      .find((c) => c.id === target.competitionId)
      ?.purposes.find((p) => p.purpose === "auction")?.document?.id;
    if (!documentId) throw new Error("Missing auction document");
    expect(await guardian.withdrawChildConsent(target)).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(
      await guardian.giveChildConsent({ ...target, documentId })
    ).toMatchObject({ ok: true, changed: true });
    expect(
      await visitor.getLot({ lotCode: SEED_AUCTIONS.scheduled })
    ).toBeNull();
    await h.drain();
    expect(await staff.listLotsForAdmin()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lotCode: SEED_AUCTIONS.scheduled,
          status: "cancelled",
        }),
        expect.objectContaining({
          lotCode: SEED_AUCTIONS.open,
          status: "open",
        }),
      ])
    );
    expect(await visitor.getLot({ lotCode: SEED_AUCTIONS.open })).toMatchObject(
      { creatorCredit: "Asha Rao" }
    );
  });
});
