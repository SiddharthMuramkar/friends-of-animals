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
