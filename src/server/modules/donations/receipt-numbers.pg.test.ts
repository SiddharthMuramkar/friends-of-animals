// Donations captured at once, from separate connections on real
// PostgreSQL (`pnpm test:pg`). Receipt numbers come from one counter row
// per financial year, locked by each capture until it commits: concurrent
// captures queue on it and take consecutive numbers, with no gap and no
// repeat. A webhook and a Checkout return for the same payment at once
// capture it once: the batch lock makes the second find it done.

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { donation, receipt } from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { TestSettings } from "@/test/settings";

import { donationForm } from "./testing";

let world: PgWorld;

beforeAll(async () => {
  world = createPgWorld();
  await new TestSettings({ db: world.db, clock: world.clock }).set(
    "donations.enabled",
    true
  );
});

afterAll(async () => {
  await world.close();
});

async function paidDonation() {
  const visitor = world.as({
    kind: "visitor",
    meta: { ip: "203.0.113.10", userAgent: "pg-test" },
  });
  const started = await visitor.startDonation(
    donationForm({ email: world.uniqueEmail() })
  );
  if (!started.ok) throw new Error(`Start failed: ${started.error}`);
  const { donationId, checkoutToken } = started;
  const paying = await visitor.payForDonation({ donationId, checkoutToken });
  if (!paying.ok || paying.kind !== "checkout") {
    throw new Error(`No checkout: ${JSON.stringify(paying)}`);
  }
  const orderId = paying.checkout.orderId;
  const paid = world.gateway.capture(orderId);
  return { donationId, checkoutToken, orderId, ...paid, visitor };
}

describe("receipt numbers under concurrent captures", () => {
  it("gives ten donations captured at once ten consecutive numbers", async () => {
    const paid = await Promise.all(
      Array.from({ length: 10 }, () => paidDonation())
    );

    await Promise.all(
      paid.map(({ orderId, visitor }) =>
        visitor.receiveGatewayWebhook(
          world.gateway.webhook({ type: "payment.captured", orderId })
        )
      )
    );

    const ids = paid.map((each) => each.donationId);
    const rows = await world.db
      .select({ fy: receipt.fy, seq: receipt.seq })
      .from(receipt)
      .where(inArray(receipt.donationId, ids));
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((row) => row.fy)).size).toBe(1);
    const seqs = rows.map((row) => row.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(10);
    expect(seqs.at(-1)! - seqs[0]!).toBe(9);
  });

  it("captures once when the webhook and the Checkout return race", async () => {
    const one = await paidDonation();

    await Promise.all([
      one.visitor.receiveGatewayWebhook(
        world.gateway.webhook({
          type: "payment.captured",
          orderId: one.orderId,
        })
      ),
      one.visitor.confirmDonationCheckout({
        donationId: one.donationId,
        checkoutToken: one.checkoutToken,
        paymentId: one.paymentId,
        signature: one.signature,
      }),
    ]);

    const issued = await world.db
      .select()
      .from(receipt)
      .where(eq(receipt.donationId, one.donationId));
    expect(issued).toHaveLength(1);
    const [row] = await world.db
      .select({ status: donation.status })
      .from(donation)
      .where(eq(donation.id, one.donationId));
    expect(row?.status).toBe("captured");
  });
});
