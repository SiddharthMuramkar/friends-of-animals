import { describe, expect, it } from "vitest";

import type { PaymentBatchStatus } from "./batch-status";
import {
  decideCapture,
  type BatchForCapture,
  type GatewayPayment,
} from "./capture-decision";

const ORDER = "order_FAKE0001";

const batch = (
  status: PaymentBatchStatus,
  overrides: Partial<BatchForCapture> = {}
): BatchForCapture => ({
  status,
  orderId: ORDER,
  amountMinor: 45_000n,
  currency: "INR",
  ...overrides,
});

const payment = (
  id: string,
  status: GatewayPayment["status"],
  overrides: Partial<GatewayPayment> = {}
): GatewayPayment => ({
  id,
  orderId: ORDER,
  status,
  amountMinor: 45_000n,
  currency: "INR",
  ...overrides,
});

describe("decideCapture()", () => {
  it("captures an open batch when its order has a captured payment for the full amount", () => {
    expect(
      decideCapture(batch("order_created"), [
        payment("pay_1", "failed"),
        payment("pay_2", "captured"),
      ])
    ).toEqual({ kind: "capture", paymentId: "pay_2", otherCapturedIds: [] });
  });

  it("waits while no payment on the order is captured", () => {
    expect(decideCapture(batch("order_created"), [])).toEqual({
      kind: "awaiting_payment",
    });
    expect(
      decideCapture(batch("order_created"), [
        payment("pay_1", "created"),
        payment("pay_2", "authorized"),
        payment("pay_3", "failed"),
      ])
    ).toEqual({ kind: "awaiting_payment" });
  });

  it("changes nothing for a batch that is already captured, however often it is told", () => {
    const payments = [payment("pay_2", "captured")];
    expect(decideCapture(batch("captured"), payments)).toEqual({
      kind: "already_captured",
    });
    expect(decideCapture(batch("captured"), payments)).toEqual({
      kind: "already_captured",
    });
  });

  it("ignores payments on other orders", () => {
    expect(
      decideCapture(batch("order_created"), [
        payment("pay_9", "captured", { orderId: "order_OTHER" }),
      ])
    ).toEqual({ kind: "awaiting_payment" });
  });

  it("waits for a batch that has no order yet", () => {
    expect(
      decideCapture(batch("created", { orderId: null }), [
        payment("pay_1", "captured"),
      ])
    ).toEqual({ kind: "awaiting_payment" });
  });

  it("stops on a captured payment whose amount differs from the batch", () => {
    expect(
      decideCapture(batch("order_created"), [
        payment("pay_1", "captured", { amountMinor: 44_999n }),
      ])
    ).toEqual({ kind: "amount_mismatch", paymentId: "pay_1" });
  });

  it("stops on a captured payment in another currency", () => {
    expect(
      decideCapture(batch("order_created"), [
        payment("pay_1", "captured", { currency: "USD" }),
      ])
    ).toEqual({ kind: "amount_mismatch", paymentId: "pay_1" });
  });

  it.each(["failed", "cancelled"] as const)(
    "flags a capture on a %s batch as not payable instead of confirming it",
    (status) => {
      expect(
        decideCapture(batch(status), [payment("pay_1", "captured")])
      ).toEqual({ kind: "not_payable", paymentId: "pay_1" });
    }
  );

  it("captures with the first matching payment and names any other captured ones", () => {
    expect(
      decideCapture(batch("order_created"), [
        payment("pay_1", "captured"),
        payment("pay_2", "captured"),
      ])
    ).toEqual({
      kind: "capture",
      paymentId: "pay_1",
      otherCapturedIds: ["pay_2"],
    });
  });

  it("does not count a refunded payment as captured", () => {
    expect(
      decideCapture(batch("order_created"), [payment("pay_1", "refunded")])
    ).toEqual({ kind: "awaiting_payment" });
  });
});
