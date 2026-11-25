// PostgreSQL row locking is the real concurrency seam; PGlite serializes
// transactions and cannot prove two simultaneous managers compete safely.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { SEED_AUCTIONS } from "@/server/seed/auctions";

let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});
describe("auction reservation concurrency", () => {
  it("allows only one active lot on an original, even under concurrent requests", async () => {
    await world.seed.preview();
    const actor = await world.signedIn(SEED_AUCTIONS.manager, {
      secondFactor: true,
    });
    const manager = world.as(actor);
    const artwork = (await manager.listEligibleArtwork()).find(
      (a) => a.artworkCode === SEED_AUCTIONS.eligibleArtworkCode
    );
    if (!artwork) throw new Error("Seed original missing");
    const now = world.clock.now(),
      input = {
        artworkId: artwork.artworkId,
        story: "A reserved original",
        basePricePaise: 10000n,
        reservePricePaise: 20000n,
        opensAt: new Date(now.getTime() + 3600000),
        closesAt: new Date(now.getTime() + 7200000),
      };
    const outcomes = await Promise.all([
      manager.createLot(input),
      manager.createLot(input),
    ]);
    const successful = outcomes.filter((o) => o.ok);
    expect(successful).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toMatchObject([
      { error: "ineligible", reasons: ["already_listed"] },
    ]);
    const created = successful[0];
    if (!created?.ok) throw new Error("Missing reserved lot");
    expect(
      await manager.cancelLot({ lotId: created.lotId, reason: "Test complete" })
    ).toMatchObject({ ok: true });
    expect(
      (await manager.listEligibleArtwork()).some(
        (a) => a.artworkId === artwork.artworkId
      )
    ).toBe(true);
  });
});

it("serializes a family return and a competing reservation against the actual artwork lock", async () => {
  await world.seed.preview();
  world.clock.set(new Date());
  const { eq } = await import("drizzle-orm");
  const { artworkResultsWindow, artworkReturnRequest, physicalArtwork } =
    await import("@/server/db/schema");
  const { SEED_ACCOUNTS } = await import("@/server/seed/accounts");
  const [artwork] = await world.db
    .select()
    .from(physicalArtwork)
    .where(eq(physicalArtwork.artworkCode, SEED_AUCTIONS.eligibleArtworkCode));
  if (!artwork) throw new Error("Seed artwork missing");
  const [original] = await world.db
    .select()
    .from(artworkResultsWindow)
    .where(eq(artworkResultsWindow.competitionId, artwork.competitionId));
  if (!original) throw new Error("Results window fixture missing");
  const family = world.as(await world.signedIn(SEED_ACCOUNTS.members[1]));
  const manager = world.as(
    await world.signedIn(SEED_AUCTIONS.manager, { secondFactor: true })
  );
  const now = world.clock.now();
  // A throwaway fixture, isolated from other tests by restoring the window.
  await world.db
    .update(artworkResultsWindow)
    .set({
      resultsPublishedAt: new Date(+now - 30 * 86400000 + 60000),
      closesAt: new Date(+now + 60000),
    })
    .where(eq(artworkResultsWindow.competitionId, original.competitionId));
  const input = {
    artworkId: artwork.id,
    story: "A reserved original",
    basePricePaise: 10000n,
    reservePricePaise: 20000n,
    opensAt: new Date(+now + 3600000),
    closesAt: new Date(+now + 7200000),
  };
  try {
    let returning!: ReturnType<typeof family.requestArtworkReturn>;
    let reserving!: ReturnType<typeof manager.createLot>;
    await world.sql.begin(async (tx) => {
      await tx`select id from physical_artwork where id=${artwork.id} for update`;
      returning = family.requestArtworkReturn({ artworkId: artwork.id });
      await world.waitForLockWaiters(1);
      reserving = manager.createLot(input);
      await world.waitForLockWaiters(2);
    });
    expect(await returning).toMatchObject({ ok: true });
    expect(await reserving).toMatchObject({
      ok: false,
      reasons: ["return_requested", "return_window_pending"],
    });
    world.clock.set(new Date(+now + 60000));
    expect(await manager.createLot(input)).toMatchObject({
      ok: false,
      reasons: ["return_requested"],
    });
  } finally {
    await world.db
      .delete(artworkReturnRequest)
      .where(eq(artworkReturnRequest.artworkId, artwork.id));
    await world.db
      .update(artworkResultsWindow)
      .set({
        resultsPublishedAt: original.resultsPublishedAt,
        closesAt: original.closesAt,
      })
      .where(eq(artworkResultsWindow.competitionId, original.competitionId));
  }
});

it("serializes a consent re-pin and lot creation on the competition lock", async () => {
  const { and, eq } = await import("drizzle-orm");
  const { uuidv7 } = await import("@/server/ids");
  const {
    competition,
    competitionAgeGroup,
    competitionConsentDocument,
    consentDocument,
    consentEvent,
    entry,
    physicalArtwork,
    registration,
    artworkResultsWindow,
  } = await import("@/server/db/schema");
  world.clock.set(new Date());
  const now = world.clock.now();
  const [sample] = await world.db
    .select({ artwork: physicalArtwork, entry, registration })
    .from(physicalArtwork)
    .innerJoin(entry, eq(entry.id, physicalArtwork.entryId))
    .innerJoin(
      registration,
      eq(registration.id, physicalArtwork.registrationId)
    )
    .where(eq(physicalArtwork.artworkCode, SEED_AUCTIONS.eligibleArtworkCode));
  if (!sample) throw new Error("Seed artwork missing");
  const [old] = await world.db
    .select({ document: consentDocument })
    .from(competitionConsentDocument)
    .innerJoin(
      consentDocument,
      eq(consentDocument.id, competitionConsentDocument.consentDocumentId)
    )
    .where(
      and(
        eq(
          competitionConsentDocument.competitionId,
          sample.artwork.competitionId
        ),
        eq(competitionConsentDocument.purpose, "auction")
      )
    );
  const [grant] = await world.db
    .select()
    .from(consentEvent)
    .where(
      and(
        eq(consentEvent.documentId, old!.document.id),
        eq(consentEvent.competitionId, sample.artwork.competitionId),
        eq(consentEvent.subjectType, "user"),
        eq(consentEvent.action, "given"),
        eq(
          consentEvent.giverUserId,
          (await import("@/server/seed/accounts")).SEED_ACCOUNTS.members[1].id
        )
      )
    );
  if (!old || !grant) throw new Error("Old consent fixture missing");
  const publisher = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(publisher, {
    role: "staff_admin",
    scope: { type: "global" },
  });
  await world.seed.authenticator(publisher);
  const admin = world.as(
    await world.signedIn(publisher, { secondFactor: true })
  );
  const changed = await admin.publishConsentDocument({
    purpose: "auction",
    title: "A different proceeds version",
    source:
      "## Auction\nAn original may be auctioned.\n\n## Auction proceeds\nThe creator receives 0% of the auction proceeds; Friends of Animals receives the remainder.",
  });
  if (!changed.ok) throw new Error("New consent document refused");
  const auctioneer = world.as(
    await world.signedIn(SEED_AUCTIONS.manager, { secondFactor: true })
  );
  for (const reservationFirst of [true, false]) {
    const comp = await world.seed.competition({
      code: reservationFirst ? "ECOLOT27" : "ECOPOL27",
      name: reservationFirst
        ? "Policy race: reservation first"
        : "Policy race: pin first",
      status: "results_published",
      auctionPermitted: true,
      ageGroups: [{ label: "Adults", minAge: 18, maxAge: 99 }],
    });
    const [group] = await world.db
      .select()
      .from(competitionAgeGroup)
      .where(eq(competitionAgeGroup.competitionId, comp.id));
    const id = () => uuidv7(now);
    const regId = id(),
      entryId = id(),
      artworkId = id();
    await world.db.transaction(async (tx) => {
      await tx
        .update(competition)
        .set({ auctionCreatorShareBps: 2500 })
        .where(eq(competition.id, comp.id));
      await tx.insert(competitionConsentDocument).values({
        competitionId: comp.id,
        purpose: "auction",
        consentDocumentId: old.document.id,
        attachedAt: now,
      });
      await tx.insert(registration).values({
        ...sample.registration,
        id: regId,
        competitionId: comp.id,
        ageGroupId: group!.id,
        registrationNumber: `${comp.code}-R-5EED01`,
      });
      await tx.insert(entry).values({
        ...sample.entry,
        id: entryId,
        competitionId: comp.id,
        registrationId: regId,
        code: `${comp.code}-E-5EED01`,
      });
      await tx.insert(physicalArtwork).values({
        ...sample.artwork,
        id: artworkId,
        competitionId: comp.id,
        registrationId: regId,
        entryId,
        artworkCode: `${comp.code}-A-5EED01`,
        status: "verified",
        retainedAt: null,
      });
      await tx.insert(consentEvent).values({
        ...grant,
        id: id(),
        competitionId: comp.id,
        occurredAt: now,
      });
      await tx.insert(artworkResultsWindow).values({
        competitionId: comp.id,
        releaseId: id(),
        resultsPublishedAt: new Date(+now - 31 * 86400000),
        closesAt: new Date(+now - 86400000),
      });
    });
    const member = await world.seed.member({ email: world.uniqueEmail() });
    await world.seed.grant(member, {
      role: "competition_manager",
      scope: { type: "competition", id: comp.id },
    });
    await world.seed.authenticator(member);
    const manager = world.as(
      await world.signedIn(member, { secondFactor: true })
    );
    const input = {
      artworkId,
      story: "A consented original",
      basePricePaise: 10000n,
      reservePricePaise: 20000n,
      opensAt: new Date(+now + 3600000),
      closesAt: new Date(+now + 7200000),
    };
    let reserve!: ReturnType<typeof auctioneer.createLot>;
    let repin!: ReturnType<typeof manager.attachConsentDocument>;
    const create = () => {
      reserve = auctioneer.createLot(input);
    };
    const attach = () => {
      repin = manager.attachConsentDocument({
        competitionId: comp.id,
        purpose: "auction",
      });
    };
    await world.sql.begin(async (tx) => {
      await tx`select id from competition where id=${comp.id} for no key update`;
      (reservationFirst ? create : attach)();
      await world.waitForLockWaiters(1);
      (reservationFirst ? attach : create)();
      await world.waitForLockWaiters(2);
    });
    const [created, pinned] = await Promise.all([reserve, repin]);
    if (reservationFirst) {
      expect(created).toMatchObject({ ok: true });
      expect(pinned).toMatchObject({ ok: false, error: "auction_active" });
      if (created.ok)
        await auctioneer.cancelLot({
          lotId: created.lotId,
          reason: "Test complete",
        });
    } else {
      expect(pinned).toMatchObject({ ok: true, document: { id: changed.id } });
      expect(created).toMatchObject({
        ok: false,
        reasons: ["auction_consent_missing"],
      });
    }
  }
});
