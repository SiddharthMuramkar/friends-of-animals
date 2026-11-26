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
  it.each(["observed", "ambiguous"] as const)(
    "serializes %s capture and the concurrent expiry using batch then lot locks",
    async (kind) => {
      world.clock.set(new Date());
      await world.seed.preview();
      const ambiguous = kind === "ambiguous";
      const buyer = world.as(
        await world.signedIn(
          ambiguous ? SEED_AUCTIONS.buyerMobile : SEED_AUCTIONS.buyer
        )
      );
      const code = {
        lotCode: ambiguous
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
      world.clock.set(new Date(+offer.expiresAt - 2000));
      const paid = world.gateway.capture(checkout.checkout.orderId);
      const timely = world.gateway.webhook({
        type: "payment.captured",
        orderId: checkout.checkout.orderId,
        capture: { paymentId: paid.paymentId, occurredBy: world.clock.now() },
      });
      const hook = world.gateway.webhook({
        type: "payment.captured",
        orderId: checkout.checkout.orderId,
      });
      if (ambiguous) world.clock.set(offer.expiresAt);
      let payment!: ReturnType<typeof visitor.receiveGatewayWebhook>;
      let expiry!: ReturnType<typeof worker.expireAuctionOffer>;
      await world.sql.begin(async (tx) => {
        await tx`select id from auction_lot where lot_code=${code.lotCode} for update`;
        payment = visitor.receiveGatewayWebhook(hook);
        // Provider truth is fetched before the transaction waits for the lot.
        await world.waitForLockWaiters(1);
        world.clock.set(offer.expiresAt);
        expiry = worker.expireAuctionOffer({ offerId: offer.id });
        await world.waitForLockWaiters(2);
      });
      const result = await Promise.all([payment, expiry]);
      expect(result[0]).toMatchObject({
        ok: true,
        outcome: ambiguous ? "needs_review" : "captured",
      });
      const lotStatus = async () =>
        (await manager.listLotsForAdmin()).find(
          (l) => l.lotCode === code.lotCode
        )?.status;
      expect(await lotStatus()).toBe(ambiguous ? "awaiting_payment" : "sold");
      expect(await visitor.receiveGatewayWebhook(hook)).toMatchObject({
        ok: true,
        outcome: "duplicate",
      });
      if (ambiguous) {
        expect(await visitor.receiveGatewayWebhook(timely)).toMatchObject({
          ok: true,
          outcome: "captured",
        });
        expect(await lotStatus()).toBe("sold");
      }
      expect(
        await worker.expireAuctionOffer({ offerId: offer.id })
      ).toMatchObject({ ok: false, error: "not_open" });
      const [sales] =
        await world.sql`select count(*)::int as total from ledger_posting where source_type='auction_sale' and source_id=${offer.id}`;
      expect(sales?.total).toBe(1);
    }
  );
});
