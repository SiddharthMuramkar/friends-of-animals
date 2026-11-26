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
  const { randomInt } = await import("node:crypto");
  const { eq } = await import("drizzle-orm");
  const { uuidv7 } = await import("@/server/ids");
  const {
    artworkResultsWindow,
    artworkReturnRequest,
    artworkVerification,
    competition,
    competitionAgeGroup,
    competitionConsentDocument,
    consentEvent,
    entry,
    participantProfile,
    physicalArtwork,
    registration,
  } = await import("@/server/db/schema");
  const { SEED_AUCTION_COMPETITION } =
    await import("@/server/seed/competitions");
  const { auctionPolicyDocument } = await import("../consent/auction-policy");
  const { PROFILE_PURPOSE } = await import("../registration/student-profile");
  const policy = await auctionPolicyDocument(
    world.db,
    SEED_AUCTION_COMPETITION.id
  );
  if (!policy?.compatible) throw new Error("Seed auction consent missing");

  // Other PG files drain due custody jobs on the shared database. Never
  // rewind a published window on their historical, possibly retained work.
  // Make a distinct competition, adult creator, verified original and
  // current consent; only this untouched window approaches its deadline.
  const code = `RET${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}27`;
  const comp = await world.seed.competition({
    code,
    name: `Return race ${code}`,
    status: "results_published",
    auctionPermitted: true,
    physicalArtwork: { kind: "all_shortlisted" },
    ageGroups: [{ label: "Adults", minAge: 18, maxAge: 99 }],
  });
  const [group] = await world.db
    .select()
    .from(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, comp.id));
  if (!group) throw new Error("Adult age group fixture missing");
  const member = await world.seed.member({
    email: world.uniqueEmail(),
    name: "Return race creator",
  });
  const now = world.clock.now();
  const beforeResults = new Date(+now - 31 * 86400000);
  const deadline = new Date(+now + 60000);
  const profileId = uuidv7(beforeResults),
    registrationId = uuidv7(beforeResults),
    entryId = uuidv7(beforeResults),
    artworkId = uuidv7(beforeResults);
  await world.db.transaction(async (tx) => {
    await tx
      .update(competition)
      .set({ auctionCreatorShareBps: policy.share })
      .where(eq(competition.id, comp.id));
    await tx.insert(competitionConsentDocument).values({
      competitionId: comp.id,
      purpose: "auction",
      consentDocumentId: policy.document.id,
      attachedAt: beforeResults,
    });
    await tx.insert(participantProfile).values({
      id: profileId,
      ownerKind: "self",
      ownerUserId: member.id,
      fullName: member.name,
      dobCiphertext: world.deps.cipher.encrypt(
        PROFILE_PURPOSE.dob,
        "1990-01-01"
      ),
      identityHash: profileId,
      createdAt: beforeResults,
      updatedAt: beforeResults,
    });
    await tx.insert(registration).values({
      id: registrationId,
      participantProfileId: profileId,
      competitionId: comp.id,
      route: "individual",
      ageGroupId: group.id,
      status: "confirmed",
      registrationNumber: `${comp.code}-R-5EED01`,
      createdAt: beforeResults,
      updatedAt: beforeResults,
    });
    await tx.insert(entry).values({
      id: entryId,
      code: `${comp.code}-E-5EED01`,
      competitionId: comp.id,
      registrationId,
      participantProfileId: profileId,
      discipline: "drawing",
      title: "Return race original",
      description: "A verified original in custody",
      status: "foa_verified",
      submittedAt: beforeResults,
      createdAt: beforeResults,
      updatedAt: beforeResults,
    });
    await tx.insert(physicalArtwork).values({
      id: artworkId,
      entryId,
      registrationId,
      competitionId: comp.id,
      artworkCode: `${comp.code}-A-5EED01`,
      status: "verified",
      requestedAt: beforeResults,
      dispatchDeadline: beforeResults,
      packagingInstructions: "Protect the original artwork",
      shippingPayer: "sender",
      facilityAddress: "Sample FOA address",
      receivedAt: beforeResults,
      storageLocation: "Return race shelf",
      retainedAt: null,
    });
    await tx.insert(artworkVerification).values({
      artworkId,
      verifiedAt: beforeResults,
      codeMatchesLabel: true,
      creatorConfirmed: true,
      matchesDigital: true,
      consentDocumentsOk: true,
      condition: "good",
      widthMm: 297,
      heightMm: 420,
      material: "Paper",
    });
    await tx.insert(consentEvent).values({
      id: uuidv7(beforeResults),
      subjectType: "user",
      subjectId: member.id,
      giverUserId: member.id,
      purpose: "auction",
      competitionId: comp.id,
      documentId: policy.document.id,
      action: "given",
      method: "web_form",
      occurredAt: beforeResults,
    });
    await tx.insert(artworkResultsWindow).values({
      competitionId: comp.id,
      releaseId: uuidv7(beforeResults),
      resultsPublishedAt: new Date(+deadline - 30 * 86400000),
      closesAt: deadline,
    });
  });
  const family = world.as(await world.signedIn(member));
  const manager = world.as(
    await world.signedIn(SEED_AUCTIONS.manager, { secondFactor: true })
  );
  const input = {
    artworkId,
    story: "A reserved original",
    basePricePaise: 10000n,
    reservePricePaise: 20000n,
    opensAt: new Date(+now + 3600000),
    closesAt: new Date(+now + 7200000),
  };

  let returning!: ReturnType<typeof family.requestArtworkReturn>;
  let reserving!: ReturnType<typeof manager.createLot>;
  await world.sql.begin(async (tx) => {
    await tx`select id from physical_artwork where id=${artworkId} for update`;
    returning = family.requestArtworkReturn({ artworkId });
    await world.waitForLockWaiters(1);
    reserving = manager.createLot(input);
    await world.waitForLockWaiters(2);
  });
  const returned = await returning;
  expect(returned, JSON.stringify(returned)).toMatchObject({ ok: true });
  expect(await reserving).toMatchObject({
    ok: false,
    reasons: ["return_requested", "return_window_pending"],
  });
  world.clock.set(deadline);
  expect(await manager.createLot(input)).toMatchObject({
    ok: false,
    reasons: ["return_requested"],
  });
  expect(
    await world.db
      .select()
      .from(artworkReturnRequest)
      .where(eq(artworkReturnRequest.artworkId, artworkId))
  ).toMatchObject([{ artworkId, requestedBy: member.id, fulfilledAt: null }]);
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
