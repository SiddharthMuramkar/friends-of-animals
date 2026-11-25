import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { auctionLot, fileAsset, fileDerivative } from "../db/schema";
import { SEED_ACCOUNTS } from "./accounts";
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
          { lotCode: SEED_AUCTIONS.paymentOffer, status: "awaiting_payment" },
          { lotCode: SEED_AUCTIONS.paid, status: "sold" },
        ].map((x) => expect.objectContaining(x))
      )
    );
    expect(
      await visitor.getLot({ lotCode: SEED_AUCTIONS.scheduled })
    ).toMatchObject({ creatorCredit: "Rohan D." });
    expect(await visitor.getLot({ lotCode: SEED_AUCTIONS.open })).toMatchObject(
      { creatorCredit: "Asha Rao", currentBidPaise: SEED_AUCTIONS.openBidPaise }
    );
    expect(
      await visitor.getLot({ lotCode: SEED_AUCTIONS.cancelled })
    ).toBeNull();
    expect(await manager.listEligibleArtwork()).toHaveLength(2);
    const publicJson = JSON.stringify(
      await visitor.browseLots(),
      (_key, value) => (typeof value === "bigint" ? value.toString() : value)
    );
    const privateKeys = [
      ...(await h.db.select({ key: fileAsset.storageKey }).from(fileAsset)),
      ...(await h.db
        .select({ key: fileDerivative.storageKey })
        .from(fileDerivative)),
    ];
    for (const { key } of privateKeys) expect(publicJson).not.toContain(key);
    expect(publicJson).not.toContain("Rohan Desai");
    expect(publicJson).not.toContain("reservePricePaise");
    expect(publicJson).not.toContain(SEED_ACCOUNTS.members[1].id);
    expect(publicJson).not.toContain(SEED_ACCOUNTS.members[1].name);
    const buyer = h.as(await h.signIn(SEED_AUCTIONS.buyer));
    expect(
      await buyer.getMyAuctionOffer({ lotCode: SEED_AUCTIONS.paymentOffer })
    ).toMatchObject({ status: "open" });
    expect(
      await buyer.getMyAuctionOffer({ lotCode: SEED_AUCTIONS.paid })
    ).toMatchObject({ status: "paid", deliveryStatus: "receipt_confirmed" });
    await h.seed.preview();
    expect(await visitor.getLot({ lotCode: SEED_AUCTIONS.open })).toMatchObject(
      { currentBidPaise: SEED_AUCTIONS.openBidPaise }
    );
    expect(
      await h.db
        .select()
        .from(auctionLot)
        .where(eq(auctionLot.lotCode, SEED_AUCTIONS.open))
    ).toHaveLength(1);
  });
});
