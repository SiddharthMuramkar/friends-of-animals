import { describe, expect, it } from "vitest";
import {
  auditLog,
  donation,
  donor,
  ledgerPosting,
  outbox,
  receipt,
} from "@/server/db/schema";
import { createHarness } from "@/test/harness";
import { openDonations } from "../testing";

const PAN = "ABCDE1234F";
const input = {
  amountMinor: 100_000n,
  showOnWall: false,
  declaredAdult: true,
  declaredIndianSource: true,
};

describe("80G and recurring donations", () => {
  it("discards PAN while 80G is off and issues ordinary receipts even if enabled later", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("donations.recurringEnabled", true);
    const actor = await h.signIn(await h.seed.member());
    expect(await h.as(actor).getDonationTerms()).toMatchObject({
      recurringEnabled: true,
      has80G: false,
    });
    const started = await h
      .as(actor)
      .startRecurringDonation({ ...input, pan: PAN });
    if (!started.ok) throw new Error("Could not start mandate");
    expect(await h.db.select({ pan: donor.pan }).from(donor)).toEqual([
      { pan: null },
    ]);

    await h.settings.set("org.has80G", true);
    const subscriptionId = started.checkout.subscriptionId;
    h.gateway.authoriseSubscription(subscriptionId);
    h.gateway.chargeSubscription(subscriptionId);
    await h.as(h.visitor()).receiveGatewayWebhook(
      h.gateway.webhook({
        type: "subscription.charged",
        orderId: null,
        subscriptionId,
      })
    );
    await h.drain();
    expect(await h.db.select().from(receipt)).toMatchObject([
      { snapshot: { taxExemption: null } },
    ]);
  });

  it("requires a valid PAN before creating a mandate, encrypts it, and freezes each monthly tax receipt", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("donations.recurringEnabled", true);
    await h.settings.set("org.has80G", true);
    const actor = await h.signIn(await h.seed.member());
    expect(await h.as(actor).getDonationTerms()).toMatchObject({
      recurringEnabled: true,
      has80G: true,
    });
    for (const pan of [undefined, "invalid"]) {
      expect(
        await h.as(actor).startRecurringDonation({ ...input, pan })
      ).toEqual({
        ok: false,
        error: "invalid_input",
        fields: ["pan"],
      });
    }
    expect(h.gateway.plans).toHaveLength(0);
    expect(h.gateway.subscriptions).toHaveLength(0);
    expect(await h.db.select().from(donor)).toHaveLength(0);

    const started = await h
      .as(actor)
      .startRecurringDonation({ ...input, pan: PAN.toLowerCase() });
    if (!started.ok) throw new Error("Could not start mandate");
    const [stored] = await h.db.select({ pan: donor.pan }).from(donor);
    expect(stored?.pan).toBeTruthy();
    expect(stored?.pan).not.toContain(PAN);
    expect(h.deps.cipher.decrypt("donor.pan", stored!.pan!)).toBe(PAN);
    const subscriptionId = started.checkout.subscriptionId;
    h.gateway.authoriseSubscription(subscriptionId);
    const charge = async () => {
      h.gateway.chargeSubscription(subscriptionId);
      const event = h.gateway.webhook({
        type: "subscription.charged",
        orderId: null,
        subscriptionId,
      });
      await h.as(h.visitor()).receiveGatewayWebhook(event);
      await h.as(h.visitor()).receiveGatewayWebhook(event);
      await h.drain();
    };
    await charge();
    const [first] = await h.db
      .select({ snapshot: receipt.snapshot })
      .from(receipt);
    expect(first?.snapshot.taxExemption).toEqual({
      scheme: "80G",
      donorPanMasked: "******234F",
    });

    await h.settings.set("org.has80G", false);
    h.clock.advance({ days: 31 });
    await charge();
    const issued = await h.db
      .select({ snapshot: receipt.snapshot })
      .from(receipt)
      .orderBy(receipt.seq);
    expect(issued).toHaveLength(2);
    expect(issued[0]).toEqual(first);
    expect(issued[1]?.snapshot.taxExemption).toBeNull();
    expect(await h.db.select().from(donation)).toHaveLength(2);
    expect(await h.db.select().from(ledgerPosting)).toHaveLength(2);
    expect(JSON.stringify(issued)).not.toContain(PAN);
    expect(JSON.stringify(await h.db.select().from(auditLog))).not.toContain(
      PAN
    );
    expect(
      JSON.stringify(
        await h.db.select({ payload: outbox.payload }).from(outbox)
      )
    ).not.toContain(PAN);
  });
});
