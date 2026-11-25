import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { auctionLot } from "../db/schema";
import { SEED_AUCTIONS } from "./auctions";
import { eq } from "drizzle-orm";

describe("preview auction lots", () => {
  it("seeds open/upcoming lots and terminal examples; safe to rerun", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const staff = await h.signIn(SEED_AUCTIONS.manager);
    const manager = h.as(staff),
      visitor = h.as(h.visitor());
    expect(await manager.listLotsForAdmin()).toMatchObject(
      expect.arrayContaining(
        [
          { lotCode: SEED_AUCTIONS.open, status: "open" },
          { lotCode: SEED_AUCTIONS.scheduled, status: "scheduled" },
          { lotCode: SEED_AUCTIONS.unsold, status: "unsold" },
          { lotCode: SEED_AUCTIONS.cancelled, status: "cancelled" },
        ].map((x) => expect.objectContaining(x))
      )
    );
    expect(
      await visitor.getLot({ lotCode: SEED_AUCTIONS.scheduled })
    ).toMatchObject({ creatorCredit: "Rohan D." });
    expect(await visitor.getLot({ lotCode: SEED_AUCTIONS.open })).toMatchObject(
      { creatorCredit: "Asha Rao" }
    );
    expect(
      await visitor.getLot({ lotCode: SEED_AUCTIONS.cancelled })
    ).toBeNull();
    expect(await manager.listEligibleArtwork()).toHaveLength(2);
    await h.seed.preview();
    expect(
      await h.db
        .select()
        .from(auctionLot)
        .where(eq(auctionLot.lotCode, SEED_AUCTIONS.open))
    ).toHaveLength(1);
  });
});
