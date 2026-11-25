import { describe, expect, it } from "vitest";
import {
  donation,
  receipt,
  ledgerPosting,
  refund,
  outbox,
} from "@/server/db/schema";
import { setup } from "./testing";

describe("monthly charges", () => {
  it("records exactly one receipt and posting per capture, even across repeated signals", async () => {
    const { h, actor, id, subscriptionId, send, signal } = await setup();
    const returned = h.gateway.authoriseSubscription(subscriptionId);
    expect(
      await h.as(actor).confirmRecurringCheckout({ id, ...returned })
    ).toMatchObject({ ok: true, status: "active" });
    h.gateway.chargeSubscription(subscriptionId);
    const event = signal("subscription.charged");
    expect((await h.as(h.visitor()).receiveGatewayWebhook(event)).ok).toBe(
      true
    );
    expect(await h.as(h.visitor()).receiveGatewayWebhook(event)).toEqual({
      ok: true,
      outcome: "duplicate",
    });
    await send("subscription.charged");
    await h.drain();
    expect(await h.db.select().from(donation)).toHaveLength(1);
    expect(await h.db.select().from(receipt)).toMatchObject([
      { number: "FOA-RCPT-2627-000001" },
    ]);
    expect(await h.db.select().from(ledgerPosting)).toHaveLength(1);
    h.clock.advance({ days: 31 });
    h.gateway.chargeSubscription(subscriptionId);
    await send("subscription.charged");
    await h.drain();
    expect(
      await h.db.select().from(receipt).orderBy(receipt.seq)
    ).toMatchObject([
      { number: "FOA-RCPT-2627-000001" },
      { number: "FOA-RCPT-2627-000002" },
    ]);
    expect(await h.db.select().from(ledgerPosting)).toHaveLength(2);
    expect(await h.as(actor).getMyRecurringDonation({ id })).toMatchObject({
      ok: true,
      charges: [{}, {}],
    });
  });
  it("does not record a failed charge and refuses another account's checkout return", async () => {
    const { h, actor, id, subscriptionId, send } = await setup();
    const returnFields = h.gateway.authoriseSubscription(subscriptionId);
    const other = await h.signIn(await h.seed.member());
    expect(
      await h.as(other).confirmRecurringCheckout({ id, ...returnFields })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h
        .as(actor)
        .confirmRecurringCheckout({ id, ...returnFields, signature: "invalid" })
    ).toEqual({ ok: false, error: "invalid_signature" });
    await send("subscription.authenticated");
    h.gateway.failSubscriptionCharge(subscriptionId);
    await send("subscription.pending");
    await send("subscription.pending");
    await h.drain();
    expect(await h.db.select().from(donation)).toHaveLength(0);
    expect(
      h.email.sent.filter(
        (m) => m.subject === "Your monthly donation could not be charged"
      )
    ).toHaveLength(1);
    expect(await h.as(actor).getMyRecurringDonation({ id })).toMatchObject({
      ok: true,
      recurring: { status: "past_due" },
    });
  });
  it("refuses international INR charges while FCRA is disabled without issuing a receipt", async () => {
    const { h, actor, id, subscriptionId, send } = await setup();
    h.gateway.authoriseSubscription(subscriptionId);
    await send("subscription.authenticated");
    h.gateway.chargeSubscription(subscriptionId, { international: true });
    await send("subscription.charged");
    await send("subscription.charged");
    await h.drain();
    expect(await h.db.select().from(donation)).toHaveLength(0);
    expect(await h.db.select().from(receipt)).toHaveLength(0);
    expect(await h.db.select().from(refund)).toMatchObject([
      { kind: "foreign_payment", status: "refunded" },
    ]);
    expect(await h.db.select().from(ledgerPosting)).toHaveLength(2);
    expect(await h.as(actor).getMyRecurringDonation({ id })).toMatchObject({
      ok: true,
      recurring: { status: "active" },
    });
  });
  it("mirrors a halted mandate and sends one failure notice for the cycle", async () => {
    const { h, actor, id, subscriptionId, send } = await setup();
    h.gateway.authoriseSubscription(subscriptionId);
    await send("subscription.authenticated");
    h.gateway.failSubscriptionCharge(subscriptionId);
    await send("subscription.pending");
    h.gateway.haltSubscription(subscriptionId);
    await send("subscription.halted");
    await h.drain();
    expect(await h.as(actor).getMyRecurringDonation({ id })).toMatchObject({
      ok: true,
      recurring: { status: "halted" },
    });
    expect(
      h.email.sent.filter(
        (m) => m.subject === "Your monthly donation could not be charged"
      )
    ).toHaveLength(1);
    const once = await h.db.select().from(outbox);
    await send("subscription.halted");
    await h.drain();
    expect(await h.db.select().from(outbox)).toEqual(once);
    h.gateway.chargeSubscription(subscriptionId);
    await send("subscription.charged");
    expect(await h.as(actor).getMyRecurringDonation({ id })).toMatchObject({
      ok: true,
      recurring: { status: "active" },
    });
  });
});
