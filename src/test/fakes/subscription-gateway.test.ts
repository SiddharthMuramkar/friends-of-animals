import { describe, expect, it } from "vitest";

import { subscriptionGatewayContract } from "@/server/ports/subscription-gateway.contract";

import { FakeClock } from "./clock";
import { FakeSubscriptionGateway } from "./subscription-gateway";

subscriptionGatewayContract("FakeSubscriptionGateway", async () => {
  const clock = new FakeClock();
  const gateway = new FakeSubscriptionGateway(clock);
  return {
    gateway,
    clock,
    authorise: async (id) => gateway.authoriseSubscription(id),
    charge: async (id, options) => gateway.chargeSubscription(id, options),
  };
});

const MONTHLY_1000 = {
  amountMinor: 100000n,
  currency: "INR",
  period: "monthly",
  interval: 1,
  name: "Monthly donation",
} as const;

async function authorised(totalCount = 120) {
  const clock = new FakeClock("2027-01-15T04:30:00.000Z");
  const gateway = new FakeSubscriptionGateway(clock);
  const { planId } = await gateway.createPlan(MONTHLY_1000);
  const { id } = await gateway.createSubscription({
    planId,
    totalCount,
    customerNotify: false,
    notes: {},
  });
  gateway.authoriseSubscription(id);
  return { clock, gateway, id };
}

describe("FakeSubscriptionGateway", () => {
  it("keeps every plan created, with its amount", async () => {
    const gateway = new FakeSubscriptionGateway(new FakeClock());
    await gateway.createPlan(MONTHLY_1000);
    await gateway.createPlan({ ...MONTHLY_1000, amountMinor: 50000n });

    expect(gateway.plans.map((plan) => plan.amountMinor)).toEqual([
      100000n,
      50000n,
    ]);
  });

  it("keeps the options each subscription was created with", async () => {
    const gateway = new FakeSubscriptionGateway(new FakeClock());
    const { planId } = await gateway.createPlan(MONTHLY_1000);
    await gateway.createSubscription({
      planId,
      totalCount: 120,
      customerNotify: false,
      notes: { recurringDonationId: "r1" },
    });

    expect(gateway.subscriptions).toEqual([
      expect.objectContaining({
        planId,
        totalCount: 120,
        customerNotify: false,
        notes: { recurringDonationId: "r1" },
      }),
    ]);
  });

  it("charges each subscription that is due when a cycle runs", async () => {
    const { clock, gateway, id } = await authorised();
    gateway.runCycle();
    clock.advance({ days: 31 });
    gateway.runCycle();
    gateway.runCycle();

    const charges = await gateway.fetchSubscriptionCharges(id);
    expect(charges.map((charge) => charge.createdAt)).toEqual([
      new Date("2027-01-15T04:30:00.000Z"),
      new Date("2027-02-15T04:30:00.000Z"),
    ]);
  });

  it("charges nothing once a subscription is cancelled", async () => {
    const { clock, gateway, id } = await authorised();
    gateway.runCycle();
    await gateway.cancelSubscription(id, { atCycleEnd: false });
    clock.advance({ days: 62 });
    gateway.runCycle();

    expect(await gateway.fetchSubscriptionCharges(id)).toHaveLength(1);
  });

  it("completes a subscription after its last cycle", async () => {
    const { clock, gateway, id } = await authorised(2);
    gateway.chargeSubscription(id);
    clock.advance({ days: 31 });
    gateway.chargeSubscription(id);

    expect(await gateway.fetchSubscription(id)).toMatchObject({
      status: "completed",
      chargeAt: null,
      endedAt: clock.now(),
    });
  });

  it("moves a subscription whose charge failed to pending, cycle by cycle", async () => {
    const { clock, gateway, id } = await authorised();
    gateway.chargeSubscription(id);
    clock.advance({ days: 31 });
    gateway.failSubscriptionCharge(id);

    expect(await gateway.fetchSubscription(id)).toMatchObject({
      status: "pending",
      currentStart: new Date("2027-02-15T04:30:00.000Z"),
    });
    expect(await gateway.fetchSubscriptionCharges(id)).toHaveLength(1);
  });

  it("halts a subscription when the gateway gives up retrying", async () => {
    const { gateway, id } = await authorised();
    gateway.chargeSubscription(id);
    gateway.failSubscriptionCharge(id);
    gateway.haltSubscription(id);

    expect(await gateway.fetchSubscription(id)).toMatchObject({
      status: "halted",
    });
  });

  it("expires a mandate nobody authorised", async () => {
    const clock = new FakeClock();
    const gateway = new FakeSubscriptionGateway(clock);
    const { planId } = await gateway.createPlan(MONTHLY_1000);
    const { id } = await gateway.createSubscription({
      planId,
      totalCount: 120,
      customerNotify: false,
      notes: {},
    });

    gateway.expireSubscription(id);

    expect(await gateway.fetchSubscription(id)).toMatchObject({
      status: "expired",
      endedAt: clock.now(),
    });
  });

  it("records each cancellation that took effect", async () => {
    const { gateway, id } = await authorised();
    await gateway.cancelSubscription(id, { atCycleEnd: false });

    expect(gateway.cancelCalls).toEqual([
      { subscriptionId: id, atCycleEnd: false },
    ]);
  });

  it("fails the next cancellation when told to, leaving the subscription live", async () => {
    const { gateway, id } = await authorised();
    gateway.failNextCancel();

    await expect(
      gateway.cancelSubscription(id, { atCycleEnd: false })
    ).rejects.toThrow("FakeSubscriptionGateway: cancel failed");
    expect(gateway.cancelCalls).toEqual([]);
    expect((await gateway.fetchSubscription(id)).status).toBe("authenticated");
  });

  it("can lose the answer to a cancellation that took effect", async () => {
    const { gateway, id } = await authorised();
    gateway.failNextCancel({ afterCancelling: true });

    await expect(
      gateway.cancelSubscription(id, { atCycleEnd: false })
    ).rejects.toThrow();
    expect(gateway.cancelCalls).toHaveLength(1);
    expect((await gateway.fetchSubscription(id)).status).toBe("cancelled");
  });
});
