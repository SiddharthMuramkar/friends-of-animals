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

describe("auction bid row-lock concurrency", () => {
  it("decides equal competing bids against one locked snapshot and extends only the accepted one", async () => {
    await world.seed.preview();
    const a = world.as(
      await world.signedIn(
        await world.seed.member({ email: world.uniqueEmail() })
      )
    );
    const b = world.as(
      await world.signedIn(
        await world.seed.member({ email: world.uniqueEmail() })
      )
    );
    const visitor = world.as({ kind: "visitor", meta: {} });
    const code = { lotCode: SEED_AUCTIONS.open };
    await world.deps.settings.set("auctions.antiSnipingWindowMinutes", 7);
    await world.deps.settings.set("auctions.minIncrementPaise", 5000);
    const lot = await visitor.getLot(code);
    if (!lot) throw new Error("No seeded open lot");
    world.clock.set(new Date(lot.closesAt.getTime() - 60_000));
    const input = {
      ...code,
      declaredAdult: true,
      declarationVersion: "1",
      amountPaise: lot.minimumBidPaise,
    };
    let pending!: Promise<Awaited<ReturnType<typeof a.placeBid>>[]>;
    await world.sql.begin(async (tx) => {
      await tx`select id from auction_lot where lot_code=${code.lotCode} for update`;
      pending = Promise.all([a.placeBid(input), b.placeBid(input)]);
      await world.waitForLockWaiters(2);
    });
    const outcomes = await pending;
    const closesAt = new Date(lot.closesAt.getTime() + 7 * 60_000);
    expect(outcomes.filter((x) => x.ok)).toEqual([
      expect.objectContaining({ ok: true, extended: true, closesAt }),
    ]);
    expect(outcomes.filter((x) => !x.ok)).toEqual([
      expect.objectContaining({
        ok: false,
        error: "bid_too_low",
        minimumPaise: lot.minimumBidPaise + 5000n,
      }),
    ]);
    expect(await visitor.getLot(code)).toMatchObject({
      currentBidPaise: lot.minimumBidPaise,
      closesAt,
    });
  });
});
