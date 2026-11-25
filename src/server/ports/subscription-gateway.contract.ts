// Shared contract for every SubscriptionGateway adapter. The in-memory fake
// and the Razorpay adapter (over a stand-in for Razorpay's API) both run
// it, so the fake stays faithful: a fake that passes a check the Razorpay
// adapter fails is wrong. Only imported by *.test.ts.

import { describe, expect, it } from "vitest";

import type { FakeClock } from "@/test/fakes/clock";

import type {
  SubscriptionCheckoutReturn,
  SubscriptionGateway,
} from "./subscription-gateway";

export type SubscriptionGatewayContractSetup = () => Promise<{
  gateway: SubscriptionGateway;
  clock: FakeClock;
  /**
   * The donor authorises the mandate at Checkout: returns what Checkout
   * hands back to the browser, signed as the gateway signs it.
   */
  authorise(subscriptionId: string): Promise<SubscriptionCheckoutReturn>;
  /** The gateway charges the next billing cycle, now. */
  charge(
    subscriptionId: string,
    options?: { international?: boolean }
  ): Promise<{ paymentId: string }>;
}>;

const MONTHLY_1000 = {
  amountMinor: 100000n,
  currency: "INR",
  period: "monthly",
  interval: 1,
  name: "Monthly donation",
} as const;

export function subscriptionGatewayContract(
  name: string,
  setup: SubscriptionGatewayContractSetup
) {
  describe(`${name} (SubscriptionGateway contract)`, () => {
    async function subscribed(notes: Record<string, string> = {}) {
      const world = await setup();
      const { planId } = await world.gateway.createPlan(MONTHLY_1000);
      const subscription = await world.gateway.createSubscription({
        planId,
        totalCount: 120,
        customerNotify: false,
        notes,
      });
      return { ...world, planId, subscription };
    }

    it("creates a subscription on a plan that waits for the mandate", async () => {
      const { planId, subscription } = await subscribed({
        recurringDonationId: "0193a4e2-0000-7000-8000-000000000001",
      });

      expect(subscription).toEqual({
        id: expect.any(String),
        planId,
        status: "created",
        currentStart: null,
        chargeAt: null,
        endedAt: null,
        notes: { recurringDonationId: "0193a4e2-0000-7000-8000-000000000001" },
      });
    });

    it("fetches a subscription as it was created", async () => {
      const { gateway, subscription } = await subscribed({ a: "1" });

      expect(await gateway.fetchSubscription(subscription.id)).toEqual(
        subscription
      );
    });

    it("rejects a subscription it doesn't know", async () => {
      const { gateway } = await setup();

      await expect(
        gateway.fetchSubscription("sub_00000000000000")
      ).rejects.toThrow();
    });

    it("gives Checkout the subscription and the public key", async () => {
      const { gateway, subscription } = await subscribed();

      const params = gateway.subscriptionCheckout({
        subscriptionId: subscription.id,
        description: "Monthly donation of ₹1,000",
      });

      expect(params).toEqual({
        keyId: expect.stringMatching(/^rzp_(test|live)_/),
        subscriptionId: subscription.id,
        description: "Monthly donation of ₹1,000",
      });
    });

    it("accepts Checkout's signature once the donor authorises", async () => {
      const { gateway, subscription, authorise } = await subscribed();

      const returned = await authorise(subscription.id);

      expect(gateway.verifySubscriptionCheckout(returned)).toBe(true);
      expect(await gateway.fetchSubscription(subscription.id)).toMatchObject({
        status: "authenticated",
      });
    });

    it("refuses a signature that doesn't match the subscription and payment", async () => {
      const { gateway, subscription, authorise } = await subscribed();
      const returned = await authorise(subscription.id);
      const altered = returned.signature.replace(/.$/, (last) =>
        last === "0" ? "1" : "0"
      );

      for (const forged of [
        { ...returned, signature: altered },
        { ...returned, subscriptionId: "sub_00000000000000" },
        { ...returned, paymentId: "pay_00000000000000" },
        { ...returned, signature: "" },
      ]) {
        expect(gateway.verifySubscriptionCheckout(forged)).toBe(false);
      }
    });

    it("lists no charges before the first cycle is charged", async () => {
      const { gateway, subscription, authorise } = await subscribed();
      await authorise(subscription.id);

      expect(await gateway.fetchSubscriptionCharges(subscription.id)).toEqual(
        []
      );
    });

    it("lists each captured charge with its amount and when it was made", async () => {
      const { gateway, subscription, authorise, charge, clock } =
        await subscribed();
      await authorise(subscription.id);
      const first = await charge(subscription.id);
      const firstAt = clock.now();
      clock.advance({ days: 31 });
      const second = await charge(subscription.id);

      const charges = await gateway.fetchSubscriptionCharges(subscription.id);

      expect(charges.toSorted((a, b) => +a.createdAt - +b.createdAt)).toEqual([
        {
          paymentId: first.paymentId,
          invoiceId: expect.any(String),
          captured: true,
          amountMinor: 100000n,
          currency: "INR",
          international: false,
          createdAt: firstAt,
        },
        {
          paymentId: second.paymentId,
          invoiceId: expect.any(String),
          captured: true,
          amountMinor: 100000n,
          currency: "INR",
          international: false,
          createdAt: clock.now(),
        },
      ]);
    });

    it("marks a charge to a card from abroad as international", async () => {
      const { gateway, subscription, authorise, charge } = await subscribed();
      await authorise(subscription.id);
      await charge(subscription.id, { international: true });

      const [only] = await gateway.fetchSubscriptionCharges(subscription.id);

      expect(only?.international).toBe(true);
    });

    it("reports a charged subscription active, with the next charge to come", async () => {
      const { gateway, subscription, authorise, charge, clock } =
        await subscribed();
      await authorise(subscription.id);
      await charge(subscription.id);

      const now = await gateway.fetchSubscription(subscription.id);

      expect(now).toMatchObject({
        status: "active",
        currentStart: clock.now(),
        endedAt: null,
      });
      expect(now.chargeAt?.getTime()).toBeGreaterThan(clock.now().getTime());
    });

    it("cancels at once, so the subscription ends now", async () => {
      const { gateway, subscription, authorise, charge, clock } =
        await subscribed();
      await authorise(subscription.id);
      await charge(subscription.id);
      clock.advance({ days: 3 });

      const cancelled = await gateway.cancelSubscription(subscription.id, {
        atCycleEnd: false,
      });

      expect(cancelled).toMatchObject({
        id: subscription.id,
        status: "cancelled",
        endedAt: clock.now(),
      });
      expect(await gateway.fetchSubscription(subscription.id)).toMatchObject({
        status: "cancelled",
        endedAt: clock.now(),
      });
    });

    it("cancels a mandate nobody authorised", async () => {
      const { gateway, subscription } = await subscribed();

      const cancelled = await gateway.cancelSubscription(subscription.id, {
        atCycleEnd: false,
      });

      expect(cancelled.status).toBe("cancelled");
    });

    it("refuses to cancel a subscription that has already ended", async () => {
      const { gateway, subscription } = await subscribed();
      await gateway.cancelSubscription(subscription.id, { atCycleEnd: false });

      await expect(
        gateway.cancelSubscription(subscription.id, { atCycleEnd: false })
      ).rejects.toThrow();
    });
  });
}
