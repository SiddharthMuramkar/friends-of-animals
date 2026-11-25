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
