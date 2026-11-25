import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import {
  FALLBACK_KEY,
  FALLBACK_SIGNATURE_HEADER,
  fallbackPaymentGateway,
  isFallbackGateway,
  type FallbackWebhookBody,
} from "./payment-gateway-fallback";
import { unconfiguredPaymentGateway } from "./payment-gateway";
import { paymentGatewayContract } from "./payment-gateway.contract";

let webhookSequence = 0;

/**
 * A webhook as the fallback would post one: signed with its key, with
 * another key, or unsigned. A new call is a new event.
 */
function fallbackWebhook(
  event: {
    type: string;
    orderId: string;
    refund?: { refundId: string; paymentId: string };
  },
  { signature = "valid" }: { signature?: "valid" | "invalid" | "missing" } = {}
): { rawBody: string; headers: Headers } {
  webhookSequence += 1;
  const body: FallbackWebhookBody = {
    id: `evt_fallback_${webhookSequence}`,
    event: event.type,
    orderId: event.orderId,
    ...(event.refund ? { refund: event.refund } : {}),
  };
  const rawBody = JSON.stringify(body);
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== "missing") {
    const key = signature === "valid" ? FALLBACK_KEY : "not-the-fallback-key";
    headers.set(
      FALLBACK_SIGNATURE_HEADER,
      createHmac("sha256", key).update(rawBody).digest("hex")
    );
  }
  return { rawBody, headers };
}

paymentGatewayContract("fallbackPaymentGateway on PGlite", async () => {
  const h = await createHarness();
  const gateway = fallbackPaymentGateway({
    db: h.db,
    clock: h.clock,
    appEnv: "local",
  });
  return {
    gateway,
    capture: async (orderId) => {
      const paid = await gateway.capture(orderId);
      if (!paid) throw new Error(`No fallback order ${orderId}`);
      return paid;
    },
    webhook: (event, options) => fallbackWebhook(event, options),
  };
});

const FEES = { amountMinor: 150_000n, currency: "INR" } as const;
const BATCH = "0193a8f0-0000-7000-8000-00000000abcd";

async function world(appEnv: "local" | "preview" | "staging" = "preview") {
  const h = await createHarness();
  const gateway = fallbackPaymentGateway({ db: h.db, clock: h.clock, appEnv });
  const { orderId } = await gateway.createOrder({
    amount: FEES,
    receipt: BATCH,
    notes: {},
  });
  return { h, gateway, orderId };
}

describe("fallbackPaymentGateway", () => {
  it("refuses to build in production, where only Razorpay takes money", async () => {
    const h = await createHarness();

    expect(() =>
      fallbackPaymentGateway({ db: h.db, clock: h.clock, appEnv: "production" })
    ).toThrow(/production/);
  });

  it("names itself and gives Checkout no script key", async () => {
    const { gateway, orderId } = await world();

    expect(
      gateway.checkout({ orderId, amount: FEES, description: "Fees" })
    ).toEqual({
      gateway: "fallback",
      orderId,
      amount: FEES,
      description: "Fees",
      publicKey: null,
    });
  });

  it("keeps its orders in the database, so a later request on another instance sees them", async () => {
    const { h, gateway, orderId } = await world();
    const elsewhere = fallbackPaymentGateway({
      db: h.db,
      clock: h.clock,
      appEnv: "preview",
    });

    const { paymentId } = (await elsewhere.capture(orderId))!;

    expect(await gateway.fetchOrderPayments(orderId)).toEqual([
      {
        id: paymentId,
        orderId,
        status: "captured",
        amountMinor: 150_000n,
        currency: "INR",
        international: false,
      },
    ]);
  });

  it("records a declined payment as failed, with nothing to sign", async () => {
    const { gateway, orderId } = await world();

    const declined = await gateway.decline(orderId);

    expect(declined).toEqual({ paymentId: expect.stringMatching(/\S/) });
    expect(await gateway.fetchOrderPayments(orderId)).toEqual([
      {
        id: declined!.paymentId,
        orderId,
        status: "failed",
        amountMinor: 150_000n,
        currency: "INR",
        international: false,
      },
    ]);
  });

  it("pays nothing on an order it never made", async () => {
    const { gateway } = await world();

    expect(await gateway.capture("order_nobody_made_this")).toBeNull();
    expect(await gateway.decline("order_nobody_made_this")).toBeNull();
  });

  it("is told apart from other adapters", async () => {
    const { gateway } = await world();

    expect(isFallbackGateway(gateway)).toBe(true);
    expect(isFallbackGateway(unconfiguredPaymentGateway)).toBe(false);
    // The name alone proves nothing: only the fallback can pay an order.
    expect(
      isFallbackGateway({ ...unconfiguredPaymentGateway, name: "fallback" })
    ).toBe(false);
  });
});
