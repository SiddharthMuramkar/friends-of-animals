import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { SEED_AUCTIONS } from "@/server/seed/auctions";
import { SEED_ACCOUNTS } from "@/server/seed/accounts";
import { SEED_AUCTION_COMPETITION } from "@/server/seed/competitions";
import { SEED_GUARDIANS } from "@/server/seed/guardians";
import { signedInOfficer } from "../privacy/requests/testing";
import { readZip } from "../privacy/requests/subject-data/read-zip";

describe("auction bidding", () => {
  it("accepts an adult's first bid at the base price and requires the next increment", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const first = h.as(await h.signIn(SEED_ACCOUNTS.members[2]));
    const next = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    const visitor = h.as(h.visitor());
    const staff = h.as(await h.signIn(SEED_AUCTIONS.manager));
    const artwork = (await staff.listEligibleArtwork()).find(
      (a) => a.artworkCode === SEED_AUCTIONS.eligibleArtworkCode
    )!;
    const opensAt = new Date(h.clock.now().getTime() + 60_000);
    const closesAt = new Date(opensAt.getTime() + 3600_000);
    const created = await staff.createLot({
      artworkId: artwork.artworkId,
      story: "An original for bidding",
      basePricePaise: 100000n,
      reservePricePaise: 150000n,
      opensAt,
      closesAt,
    });
    if (!created.ok) throw new Error("Lot not created");
    expect(await staff.scheduleLot({ lotId: created.lotId })).toMatchObject({
      ok: true,
    });
    h.clock.set(opensAt);
    expect(
      await h
        .as({ kind: "system", process: "worker" })
        .openLot({ lotId: created.lotId })
    ).toMatchObject({ ok: true });
    const input = {
      lotCode: created.lotCode,
      declaredAdult: true,
      declarationVersion: "1",
    };
    await h.settings.set("auctions.minIncrementPaise", 5000);
    await expect(
      visitor.placeBid({ ...input, amountPaise: 100000n })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await first.placeBid({ ...input, amountPaise: 99999n })
    ).toMatchObject({
      ok: false,
      error: "bid_below_base",
      minimumPaise: 100000n,
    });
    expect(
      await first.placeBid({ ...input, amountPaise: 100000n })
    ).toMatchObject({ ok: true, amountPaise: 100000n });
    expect(
      await next.placeBid({ ...input, amountPaise: 104999n })
    ).toMatchObject({ ok: false, error: "bid_too_low", minimumPaise: 105000n });
    expect(
      await next.placeBid({ ...input, amountPaise: 105000n })
    ).toMatchObject({ ok: true, amountPaise: 105000n });
    const lot = await visitor.getLot(input);
    expect(lot).toMatchObject({
      currentBidPaise: 105000n,
      minimumBidPaise: 110000n,
    });
    expect(Object.keys(lot!)).not.toContain("bidderUserId");
    expect(Object.keys(lot!)).not.toContain("reservePricePaise");
    expect(
      JSON.stringify(lot, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    ).not.toContain(SEED_GUARDIANS.guardian.id);
    h.clock.set(closesAt);
    await h.drain();
    expect(await staff.getLotForAdmin({ lotId: created.lotId })).toMatchObject({
      status: "unsold",
    });
    expect(
      (await staff.listEligibleArtwork()).some(
        (a) => a.artworkId === artwork.artworkId
      )
    ).toBe(true);
  });

  it("rejects known teen accounts even if they declare adulthood, and rechecks consent and settings", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const guardian = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    const linked = h.as(await h.signIn(SEED_GUARDIANS.teen));
    const held = h.as(await h.signIn(SEED_GUARDIANS.heldTeen));
    const input = {
      lotCode: SEED_AUCTIONS.open,
      declaredAdult: true,
      declarationVersion: "1",
      amountPaise: 100000n,
    };
    expect(await linked.placeBid(input)).toMatchObject({
      ok: false,
      error: "minor",
    });
    expect(await held.placeBid(input)).toMatchObject({
      ok: false,
      error: "minor",
    });
    expect(
      await guardian.placeBid({ ...input, declaredAdult: false })
    ).toMatchObject({ ok: false, error: "declaration_required" });
    expect(
      await guardian.placeBid({ ...input, declarationVersion: "0" })
    ).toMatchObject({ ok: false, error: "declaration_required" });
    expect(
      await guardian.placeBid({ ...input, lotCode: SEED_AUCTIONS.scheduled })
    ).toMatchObject({ ok: false, error: "lot_not_open" });
    await h.settings.set("auctions.enabled", false);
    expect(await guardian.placeBid(input)).toMatchObject({
      ok: false,
      error: "auctions_disabled",
    });
    await h.settings.set("auctions.enabled", true);
    const artist = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));
    expect(
      await artist.withdrawMyAuctionConsent({
        competitionId: SEED_AUCTION_COMPETITION.id,
      })
    ).toMatchObject({ ok: true, changed: true });
    expect(await guardian.placeBid(input)).toMatchObject({
      ok: false,
      error: "auction_consent_missing",
    });
    expect(await h.as(h.visitor()).getLot(input)).toBeNull();
  });

  it("extends from the exact closing instant and settles only when the new deadline is due", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const visitor = h.as(h.visitor());
    const manager = h.as(await h.signIn(SEED_AUCTIONS.manager));
    const worker = h.as({ kind: "system", process: "worker" });
    const bidder = h.as(await h.signIn(SEED_ACCOUNTS.members[2]));
    const code = { lotCode: SEED_AUCTIONS.open };
    const before = await visitor.getLot(code);
    const ref = {
      lotId: (await manager.listLotsForAdmin()).find(
        (lot) => lot.lotCode === code.lotCode
      )!.id,
    };
    await h.settings.set("auctions.antiSnipingWindowMinutes", 7);
    h.clock.set(new Date(before!.closesAt.getTime() - 60_000));
    const end = new Date(before!.closesAt.getTime() + 7 * 60_000);
    expect(
      await bidder.placeBid({
        ...code,
        amountPaise: 150000n,
        declaredAdult: true,
        declarationVersion: "1",
      })
    ).toMatchObject({ ok: true, extended: true, closesAt: end });
    expect(await visitor.getLot(code)).toMatchObject({
      closesAt: end,
      currentBidPaise: 150000n,
    });
    h.clock.set(before!.closesAt);
    expect(await worker.closeLot(ref)).toMatchObject({
      ok: false,
      error: "not_due",
    });
    expect(await worker.closeLot(ref)).toMatchObject({
      ok: false,
      error: "not_due",
    });
    expect(await visitor.getLot(code)).toMatchObject({
      status: "open",
      closesAt: end,
    });
    h.clock.set(end);
    expect(
      await bidder.placeBid({
        ...code,
        amountPaise: 155000n,
        declaredAdult: true,
        declarationVersion: "1",
      })
    ).toMatchObject({ ok: false, error: "lot_closed" });
    await h.drain();
    expect(await manager.getLotForAdmin(ref)).toMatchObject({
      status: "awaiting_payment",
    });
    expect(await worker.settleClosedLot(ref)).toMatchObject({
      ok: false,
      error: "transition_not_allowed",
    });
    expect(await visitor.getLot(code)).toBeNull();
    expect(
      (await manager.listEligibleArtwork()).some(
        (a) => a.artworkCode === "AUCT27-A-5EED01"
      )
    ).toBe(false);
    expect(await worker.closeLot(ref)).toMatchObject({
      ok: false,
      error: "transition_not_allowed",
    });
  });

  it("tells only the previous leader, not a bidder who raises their own price", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const first = h.as(await h.signIn(SEED_ACCOUNTS.members[2]));
    const second = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    const code = {
      lotCode: SEED_AUCTIONS.open,
      declaredAdult: true,
      declarationVersion: "1",
    };
    expect(
      await first.placeBid({ ...code, amountPaise: 115000n })
    ).toMatchObject({ ok: true });
    expect(
      await first.placeBid({ ...code, amountPaise: 120000n })
    ).toMatchObject({ ok: true });
    await h.drain();
    expect(
      (await first.listInbox()).filter((m) => m.title.includes("outbid"))
    ).toEqual([]);
    expect(
      await second.placeBid({ ...code, amountPaise: 125000n })
    ).toMatchObject({ ok: true });
    await h.drain();
    const messages = (await first.listInbox()).filter((m) =>
      m.title.includes("outbid")
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      title: `You have been outbid on ${code.lotCode}`,
    });
    expect(messages[0]!.body).not.toContain(SEED_GUARDIANS.guardian.name);
    const email = h.email.sent.filter(
      (mail) => mail.subject === `You have been outbid on ${code.lotCode}`
    );
    expect(email.map((mail) => mail.to).sort()).toEqual(
      [SEED_ACCOUNTS.members[1].email, SEED_ACCOUNTS.members[2].email].sort()
    );
    expect(
      email.every((mail) => !mail.text.includes(SEED_GUARDIANS.guardian.name))
    ).toBe(true);
    expect(
      (await second.listInbox()).filter((m) => m.title.includes("outbid"))
    ).toEqual([]);
    await h.drain();
    expect(
      (await first.listInbox()).filter((m) => m.title.includes("outbid"))
    ).toHaveLength(1);
  });

  it("exports only the bidder's own bid and erases the bidder link without lowering the public price", async () => {
    const h = await createHarness();
    await h.seed.preview();
    await h.settings.set("privacy.erasureEnabled", true);
    const member = await h.seed.member();
    const buyer = h.as(await h.signIn(member));
    const visitor = h.as(h.visitor());
    const staff = h.as(await h.signIn(SEED_AUCTIONS.manager));
    const code = { lotCode: SEED_AUCTIONS.open };
    const input = {
      ...code,
      amountPaise: 160000n,
      declaredAdult: true,
      declarationVersion: "1",
    };
    expect(await buyer.placeBid(input)).toMatchObject({ ok: true });
    const access = await buyer.submitPrivacyRequest({
      type: "access",
      subject: { kind: "self" },
    });
    if (!access.ok) throw new Error("Access request failed");
    const officer = h.as((await signedInOfficer(h)).actor);
    expect(
      await officer.startPrivacyRequest({ id: access.requestId })
    ).toMatchObject({ ok: true });
    expect(
      await officer.buildSubjectExport({ id: access.requestId })
    ).toMatchObject({ ok: true });
    await h.drain();
    const link = await buyer.getPrivacyExportLink({ id: access.requestId });
    if (!link.ok) throw new Error("No access export");
    const bytes = await h.storage.get(link.url);
    if (!bytes.ok) throw new Error("No export data");
    const data = JSON.parse(readZip(bytes.bytes).text("data.json"));
    expect(data.sections.auction_bid).toEqual([
      expect.objectContaining({
        amount_paise: "160000",
        bidder_user_id: member.id,
        declaration_version: "1",
      }),
    ]);
    const filed = await buyer.submitPrivacyRequest({
      type: "erasure",
      subject: { kind: "self" },
    });
    if (!filed.ok) throw new Error("Erasure failed");
    expect(
      await officer.startPrivacyRequest({ id: filed.requestId })
    ).toMatchObject({ ok: true });
    const preview = await officer.previewErasure({ id: filed.requestId });
    if (!preview.ok) throw new Error("Plan failed");
    expect(preview.preview.plan.categories).toContainEqual(
      expect.objectContaining({
        key: "auction_bids",
        action: "anonymise",
        count: 1,
      })
    );
    expect(
      await officer.executeErasure({
        id: filed.requestId,
        fingerprint: preview.preview.plan.fingerprint,
      })
    ).toMatchObject({ ok: true });
    expect(
      await buyer.placeBid({ ...input, amountPaise: 165000n })
    ).toMatchObject({ ok: false, error: "bidder_unavailable" });
    await h.drain();
    expect(await visitor.getLot(code)).toMatchObject({
      currentBidPaise: 160000n,
      minimumBidPaise: 165000n,
    });
    const lot = await visitor.getLot(code);
    const lotId = (await staff.listLotsForAdmin()).find(
      (l) => l.lotCode === code.lotCode
    )!.id;
    h.clock.set(lot!.closesAt);
    await h.drain();
    // The erased bidder cannot receive a payment offer. No surviving bid met reserve.
    expect(await staff.getLotForAdmin({ lotId })).toMatchObject({
      status: "unsold",
    });
  });
});
