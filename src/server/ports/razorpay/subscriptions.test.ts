import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { razorpayGateway } from "./gateway";
describe("Razorpay subscriptions", () => {
  it("creates monthly plan/mandate, reads invoices and verifies the subscription-specific signature", async () => {
    const requests: { url: string; method: string; body: unknown }[] = [];
    const remote = {
      id: "sub_test",
      plan_id: "plan_test",
      status: "active",
      charge_at: 1800000000,
      current_start: 1790000000,
      notes: { recurringDonationId: "id" },
    };
    const mockFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      const answer = url.endsWith("/plans")
        ? { id: "plan_test" }
        : url.includes("/invoices?")
          ? { items: [{ id: "inv_test", payment_id: "pay_test" }] }
          : url.endsWith("/payments/pay_test")
            ? {
                id: "pay_test",
                amount: 100000,
                currency: "INR",
                international: false,
                status: "captured",
                created_at: 1790000000,
              }
            : url.endsWith("/cancel")
              ? { ...remote, status: "cancelled" }
              : remote;
      return new Response(JSON.stringify(answer), { status: 200 });
    };
    const gateway = razorpayGateway({
      keyId: "rzp_test_key",
      keySecret: "test-key",
      webhookSecret: "test-webhook",
      fetch: mockFetch,
    });
    const plan = await gateway.createPlan({
      amountMinor: 100000n,
      currency: "INR",
      period: "monthly",
      interval: 1,
      name: "FOA monthly",
    });
    expect(requests[0]?.body).toEqual({
      period: "monthly",
      interval: 1,
      item: { name: "FOA monthly", amount: 100000, currency: "INR" },
    });
    const sub = await gateway.createSubscription({
      planId: plan.planId,
      totalCount: 120,
      customerNotify: false,
      notes: { recurringDonationId: "id" },
    });
    expect(requests[1]?.body).toEqual({
      plan_id: "plan_test",
      total_count: 120,
      customer_notify: 0,
      notes: { recurringDonationId: "id" },
    });
    expect(sub.id).toBe("sub_test");
    expect(await gateway.fetchSubscriptionCharges(sub.id)).toMatchObject([
      {
        paymentId: "pay_test",
        amountMinor: 100000n,
        captured: true,
        international: false,
      },
    ]);
    expect(
      gateway.verifySubscriptionCheckout({
        subscriptionId: sub.id,
        paymentId: "pay_test",
        signature: createHmac("sha256", "test-key")
          .update("pay_test|sub_test")
          .digest("hex"),
      })
    ).toBe(true);
    expect(
      (await gateway.cancelSubscription(sub.id, { atCycleEnd: false })).status
    ).toBe("cancelled");
    expect(requests.at(-1)?.body).toEqual({ cancel_at_cycle_end: 0 });
  });
});
