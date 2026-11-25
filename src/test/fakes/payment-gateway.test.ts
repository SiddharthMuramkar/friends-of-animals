import { describe, expect, it } from "vitest";

import { paymentGatewayContract } from "@/server/ports/payment-gateway.contract";

import { FakePaymentGateway } from "./payment-gateway";

paymentGatewayContract("FakePaymentGateway", async () => {
  const gateway = new FakePaymentGateway();
  return {
    gateway,
    capture: async (orderId, amount) => gateway.capture(orderId, { amount }),
    webhook: (event, options) => gateway.webhook(event, options),
  };
});

const FEES = { amountMinor: 50000n, currency: "INR" } as const;

describe("FakePaymentGateway", () => {
  it("lists the orders it made, with their receipt and notes", async () => {
    const gateway = new FakePaymentGateway();

    const { orderId } = await gateway.createOrder({
      amount: FEES,
      receipt: "batch-1",
      notes: { batchId: "batch-1" },
    });

    expect(gateway.orders).toEqual([
      {
        orderId,
        amount: FEES,
        receipt: "batch-1",
        notes: { batchId: "batch-1" },
      },
    ]);
  });

  it("captures the order's full amount unless told otherwise", async () => {
    const gateway = new FakePaymentGateway();
    const { orderId } = await gateway.createOrder({
      amount: FEES,
      receipt: "batch-1",
      notes: {},
    });

    gateway.capture(orderId);
    gateway.capture(orderId, {
      amount: { amountMinor: 100n, currency: "INR" },
    });

    const amounts = (await gateway.fetchOrderPayments(orderId)).map(
      (payment) => payment.amountMinor
    );
    expect(amounts).toEqual([50000n, 100n]);
  });

  it("records a failed attempt", async () => {
    const gateway = new FakePaymentGateway();
    const { orderId } = await gateway.createOrder({
      amount: FEES,
      receipt: "batch-1",
      notes: {},
    });

    const { paymentId } = gateway.fail(orderId);

    expect(await gateway.fetchOrderPayments(orderId)).toEqual([
      {
        id: paymentId,
        orderId,
        status: "failed",
        amountMinor: 50000n,
        currency: "INR",
        international: false,
      },
    ]);
  });

  it("refuses the next order on demand, then opens orders again", async () => {
    const gateway = new FakePaymentGateway();
    gateway.refuseNextOrder();
    const order = { amount: FEES, receipt: "batch-1", notes: {} };

    await expect(gateway.createOrder(order)).rejects.toThrow(
      "FakePaymentGateway: order refused"
    );
    await expect(gateway.createOrder(order)).resolves.toMatchObject({
      orderId: expect.any(String),
    });
    expect(gateway.orders).toHaveLength(1);
  });

  it("fails the next read of an order's payments on demand, then reads them again", async () => {
    const gateway = new FakePaymentGateway();
    const { orderId } = await gateway.createOrder({
      amount: FEES,
      receipt: "batch-1",
      notes: {},
    });
    const { paymentId } = gateway.capture(orderId);
    gateway.failNextFetch();

    await expect(gateway.fetchOrderPayments(orderId)).rejects.toThrow(
      "FakePaymentGateway: payments unavailable"
    );
    expect(
      (await gateway.fetchOrderPayments(orderId)).map((payment) => payment.id)
    ).toEqual([paymentId]);
  });

  it("signs a webhook about no order", () => {
    const gateway = new FakePaymentGateway();
    const { rawBody, headers } = gateway.webhook({
      type: "refund.processed",
      orderId: null,
    });

    expect(gateway.readWebhook(rawBody, headers)).toMatchObject({
      type: "refund.processed",
      orderId: null,
    });
  });
});
