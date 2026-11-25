import { describe, expect, it } from "vitest";
import { setup } from "./testing";
import { donation, receipt, refund, ledgerPosting } from "@/server/db/schema";

describe("recurring cancellation", () => {
  it("cancels immediately as the owner; another member cannot cancel", async () => {
    const { h, actor, id, subscriptionId, send } = await setup();
    h.gateway.authoriseSubscription(subscriptionId);
    await send("subscription.authenticated");
    const another = await h.signIn(await h.seed.member());
    expect(await h.as(another).cancelRecurringDonation({ id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await h.as(actor).cancelRecurringDonation({ id })).toMatchObject({
      ok: true,
      status: "cancelled",
    });
    h.clock.advance({ days: 31 });
    h.gateway.runCycle();
    expect(await h.gateway.fetchSubscriptionCharges(subscriptionId)).toEqual(
      []
    );
    expect(h.gateway.cancelCalls).toEqual([subscriptionId]);
  });
  it("retries an unavailable cancel and returns a charge arriving after the request", async () => {
    const { h, actor, id, subscriptionId, send } = await setup();
    h.gateway.authoriseSubscription(subscriptionId);
    await send("subscription.authenticated");
    h.gateway.refuseNextCancel();
    expect(await h.as(actor).cancelRecurringDonation({ id })).toMatchObject({
      ok: true,
      status: "cancel_pending",
    });
    h.gateway.chargeSubscription(subscriptionId);
    await send("subscription.charged");
    await h.drain();
    expect(await h.db.select().from(donation)).toHaveLength(0);
    expect(await h.db.select().from(receipt)).toHaveLength(0);
    expect(await h.db.select().from(refund)).toMatchObject([
      { kind: "recurring_after_cancel", status: "refunded" },
    ]);
    expect(await h.db.select().from(ledgerPosting)).toHaveLength(2);
    expect(await h.as(actor).getMyRecurringDonation({ id })).toMatchObject({
      ok: true,
      recurring: { status: "cancelled" },
    });
    await send("subscription.charged");
    await h.drain();
    expect(await h.db.select().from(refund)).toHaveLength(1);
    expect(h.gateway.cancelCalls).toEqual([subscriptionId]);
  });
  it("expires unauthorised mandates as a worker only", async () => {
    const { h, actor, id } = await setup();
    await expect(
      h.as(actor).expireAbandonedRecurringDonations()
    ).rejects.toThrow();
    h.clock.advance({ days: 2 });
    expect(
      await h
        .as({ kind: "system", process: "worker" })
        .expireAbandonedRecurringDonations()
    ).toMatchObject({ ok: true });
    expect(await h.as(actor).getMyRecurringDonation({ id })).toMatchObject({
      ok: true,
      recurring: { status: "cancelled", cancelledBy: "system" },
    });
  });
});
