import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { donation, receipt } from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { TestSettings } from "@/test/settings";
let world: PgWorld;
beforeAll(async () => {
  world = createPgWorld();
  const settings = new TestSettings({ db: world.db, clock: world.clock });
  await settings.set("donations.enabled", true);
  await settings.set("donations.recurringEnabled", true);
});
afterAll(async () => {
  await world.close();
});
describe("concurrent subscription capture", () => {
  it("assigns one donation and receipt when two signed subscription signals race", async () => {
    const actor = await world.signedIn(
      await world.seed.member({ email: world.uniqueEmail() })
    );
    const app = world.as(actor);
    const started = await app.startRecurringDonation({
      amountMinor: 100_000n,
      showOnWall: false,
      declaredAdult: true,
      declaredIndianSource: true,
    });
    if (!started.ok) throw new Error("Not started");
    const subscriptionId = started.checkout.subscriptionId;
    world.gateway.authoriseSubscription(subscriptionId);
    world.gateway.chargeSubscription(subscriptionId);
    const visitor = world.as({
      kind: "visitor",
      meta: { ip: "203.0.113.10", userAgent: "pg-test" },
    });
    await Promise.all(
      [1, 2].map(() =>
        visitor.receiveGatewayWebhook(
          world.gateway.webhook({
            type: "subscription.charged",
            orderId: null,
            subscriptionId,
          })
        )
      )
    );
    const rows = await world.db
      .select()
      .from(donation)
      .where(eq(donation.recurringDonationId, started.id));
    expect(rows).toHaveLength(1);
    expect(
      await world.db
        .select()
        .from(receipt)
        .where(eq(receipt.donationId, rows[0]!.id))
    ).toHaveLength(1);
  });
});
