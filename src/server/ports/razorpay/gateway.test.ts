import { describe, expect, it } from "vitest";

import { paymentGatewayContract } from "../payment-gateway.contract";
import { razorpayGateway } from "./gateway";
import { fakeRazorpayApi, razorpayWebhook } from "./testing";

const TEST_KEYS = {
  keyId: "rzp_test_1DP5mmOlF5G5ag",
  keySecret: "test-key-secret-for-the-fetch-double",
  webhookSecret: "test-webhook-secret-for-the-fetch-double",
};

function world(keys = TEST_KEYS) {
  const api = fakeRazorpayApi(keys);
  const gateway = razorpayGateway({ ...keys, fetch: api.fetch });
  return { api, gateway };
}

paymentGatewayContract("razorpayGateway over a fetch double", async () => {
  const { api, gateway } = world();
  return {
    gateway,
    capture: async (orderId, amount) =>
      api.capture(orderId, amount.amountMinor),
    webhook: (event, { signature = "valid" } = {}) =>
      razorpayWebhook(event, {
        secret: TEST_KEYS.webhookSecret,
        signature,
      }),
  };
});

const FEES = { amountMinor: 150_000n, currency: "INR" } as const;
const BATCH = "0193a8f0-0000-7000-8000-00000000abcd";

describe("razorpayGateway", () => {
  it("is razorpay-test with test keys and razorpay with live keys", () => {
    expect(world().gateway.name).toBe("razorpay-test");
    expect(
      world({ ...TEST_KEYS, keyId: "rzp_live_1DP5mmOlF5G5ag" }).gateway.name
    ).toBe("razorpay");
  });

  it("refuses a key id that is neither a test nor a live key", () => {
    expect(() =>
      razorpayGateway({ ...TEST_KEYS, keyId: "key_1DP5mmOlF5G5ag" })
    ).toThrow(/rzp_test_ or rzp_live_/);
  });

  it("refuses to build without a secret", () => {
    expect(() => razorpayGateway({ ...TEST_KEYS, keySecret: "" })).toThrow();
    expect(() =>
      razorpayGateway({ ...TEST_KEYS, webhookSecret: "" })
    ).toThrow();
  });

  it("POSTs the order to /v1/orders with Basic auth, the amount as whole paise, INR, the batch as receipt and the notes", async () => {
    const { api, gateway } = world();

    const { orderId } = await gateway.createOrder({
      amount: FEES,
      receipt: BATCH,
      notes: { batchId: BATCH, reference: "PAWS27-I-Q2W9R" },
    });

    expect(orderId).toMatch(/^order_/);
    expect(api.requests).toEqual([
      {
        method: "POST",
        url: "https://api.razorpay.com/v1/orders",
        authorization: `Basic ${Buffer.from(`${TEST_KEYS.keyId}:${TEST_KEYS.keySecret}`).toString("base64")}`,
        contentType: "application/json",
        body: {
          amount: 150000,
          currency: "INR",
          receipt: BATCH,
          notes: { batchId: BATCH, reference: "PAWS27-I-Q2W9R" },
        },
      },
    ]);
  });

  it("refuses an amount that JSON can't carry exactly, without calling Razorpay", async () => {
    const { api, gateway } = world();

    await expect(
      gateway.createOrder({
        amount: { amountMinor: 2n ** 53n, currency: "INR" },
        receipt: BATCH,
        notes: {},
      })
    ).rejects.toThrow(RangeError);
    expect(api.requests).toEqual([]);
  });

  it("GETs /v1/orders/{id}/payments and maps every attempt's status, amount and currency", async () => {
    const { api, gateway } = world();
    const { orderId } = await gateway.createOrder({
      amount: FEES,
      receipt: BATCH,
      notes: {},
    });
    const failed = api.attempt(orderId, "failed");
    const { paymentId } = api.capture(orderId);

    const payments = await gateway.fetchOrderPayments(orderId);

    expect(api.requests.at(-1)).toMatchObject({
      method: "GET",
      url: `https://api.razorpay.com/v1/orders/${orderId}/payments`,
      authorization: expect.stringMatching(/^Basic /),
      body: null,
    });
    expect(payments).toEqual([
      {
        id: failed,
        orderId,
        status: "failed",
        amountMinor: 150_000n,
        currency: "INR",
      },
      {
        id: paymentId,
        orderId,
        status: "captured",
        amountMinor: 150_000n,
        currency: "INR",
      },
    ]);
  });

  it("rejects when Razorpay answers with an error, naming the status but never the key secret", async () => {
    const { api, gateway } = world();
    api.failNext(503);

    const refused = gateway.createOrder({
      amount: FEES,
      receipt: BATCH,
      notes: {},
    });

    await expect(refused).rejects.toThrow(/503/);
    await refused.catch((error: unknown) => {
      expect(String(error)).not.toContain(TEST_KEYS.keySecret);
    });
  });

  it("rejects when the key pair is wrong", async () => {
    const api = fakeRazorpayApi(TEST_KEYS);
    const gateway = razorpayGateway({
      ...TEST_KEYS,
      keySecret: "someone-elses-secret",
      fetch: api.fetch,
    });

    await expect(
      gateway.createOrder({ amount: FEES, receipt: BATCH, notes: {} })
    ).rejects.toThrow(/401/);
  });

  it("rejects a payments answer it can't read, rather than guessing", async () => {
    const gateway = razorpayGateway({
      ...TEST_KEYS,
      fetch: (async () =>
        new Response(
          JSON.stringify({
            entity: "collection",
            count: 1,
            items: [{ id: "pay_X", order_id: "order_X", status: "weird" }],
          }),
          { status: 200 }
        )) as typeof fetch,
    });

    await expect(gateway.fetchOrderPayments("order_X")).rejects.toThrow();
  });

  it("gives Checkout the order, the amount and the public key id, never a secret", async () => {
    const { gateway } = world();

    const checkout = gateway.checkout({
      orderId: "order_Test0000000001",
      amount: FEES,
      description: "Fees for 3 students",
    });

    expect(checkout).toEqual({
      gateway: "razorpay-test",
      orderId: "order_Test0000000001",
      amount: FEES,
      description: "Fees for 3 students",
      publicKey: TEST_KEYS.keyId,
    });
    expect(
      JSON.stringify(checkout, (_, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value
      )
    ).not.toMatch(
      new RegExp(`${TEST_KEYS.keySecret}|${TEST_KEYS.webhookSecret}`)
    );
  });
});
