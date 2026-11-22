import { describe, expect, it } from "vitest";

import {
  PaymentGatewayNotConfiguredError,
  unconfiguredPaymentGateway as gateway,
} from "./payment-gateway";

const FEES = { amountMinor: 50_000n, currency: "INR" } as const;

describe("unconfiguredPaymentGateway", () => {
  it("makes no order, opens no checkout and reads no payments", async () => {
    await expect(
      gateway.createOrder({ amount: FEES, receipt: "batch", notes: {} })
    ).rejects.toThrow(PaymentGatewayNotConfiguredError);
    expect(() =>
      gateway.checkout({ orderId: "order", amount: FEES, description: "Fees" })
    ).toThrow(PaymentGatewayNotConfiguredError);
    await expect(gateway.fetchOrderPayments("order")).rejects.toThrow(
      PaymentGatewayNotConfiguredError
    );
  });

  it("refunds nothing and reads no refunds (#80)", async () => {
    await expect(
      gateway.refund({
        paymentId: "pay",
        amount: FEES,
        idempotencyKey: "0193a8f0-0000-7000-8000-000000000001-1",
        notes: {},
      })
    ).rejects.toThrow(PaymentGatewayNotConfiguredError);
    await expect(gateway.fetchRefunds("pay")).rejects.toThrow(
      PaymentGatewayNotConfiguredError
    );
  });

  it("trusts no Checkout signature and no webhook", () => {
    expect(
      gateway.verifyCheckout({
        orderId: "order",
        paymentId: "pay",
        signature: "0".repeat(64),
      })
    ).toBe(false);
    expect(
      gateway.readWebhook(
        '{"id":"evt","event":"payment.captured"}',
        new Headers({ "x-razorpay-signature": "0".repeat(64) })
      )
    ).toBeNull();
  });
});
