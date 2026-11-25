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
describe("auction capture/expiry serialisation", () => {
  it.each([false, true])(
    "the locked clock decides a simultaneous capture and expiry (at deadline: %s)",
    async (expired) => {
      await world.seed.preview();
      const buyer = world.as(
        await world.signedIn(
          expired ? SEED_AUCTIONS.buyerMobile : SEED_AUCTIONS.buyer
        )
      );
      const code = {
        lotCode: expired
          ? SEED_AUCTIONS.paymentOfferMobile
          : SEED_AUCTIONS.paymentOffer,
      };
      const manager = world.as(
        await world.signedIn(SEED_AUCTIONS.manager, { secondFactor: true })
      );
      const worker = world.as({ kind: "system", process: "worker" });
      const visitor = world.as({
        kind: "visitor",
        meta: { ip: "203.0.113.20", userAgent: "pg race test" },
      });
      const offer = await buyer.getMyAuctionOffer(code);
      if (!offer) throw new Error("Seed offer unavailable");
      const checkout = await buyer.openAuctionCheckout({ offerId: offer.id });
      if (!checkout.ok) throw new Error("Checkout unavailable");
      world.gateway.capture(checkout.checkout.orderId);
      const hook = world.gateway.webhook({
        type: "payment.captured",
        orderId: checkout.checkout.orderId,
      });
      world.clock.set(new Date(offer.expiresAt.getTime() - (expired ? 0 : 1)));
      let pending!: Promise<unknown[]>;
      await world.sql.begin(async (tx) => {
        await tx`select id from auction_lot where lot_code=${code.lotCode} for update`;
        pending = Promise.all([
          visitor.receiveGatewayWebhook(hook),
          worker.expireAuctionOffer({ offerId: offer.id }),
        ]);
        await world.waitForLockWaiters(2);
      });
      const result = await pending;
      expect(result[0]).toMatchObject({
        ok: true,
        outcome: expired ? "needs_review" : "captured",
      });
      const lot = (await manager.listLotsForAdmin()).find(
        (l) => l.lotCode === code.lotCode
      )!;
      expect(lot.status).toBe(expired ? "relisted" : "sold");
      expect(await visitor.receiveGatewayWebhook(hook)).toMatchObject({
        ok: true,
        outcome: "duplicate",
      });
      if (!expired) {
        world.clock.set(offer.expiresAt);
        expect(
          await worker.expireAuctionOffer({ offerId: offer.id })
        ).toMatchObject({ ok: false, error: "not_open" });
      }
    }
  );
});
