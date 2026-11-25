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
  knownPaymentIds: [],
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
  international: false,
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
    // A captured batch knows the payment it was captured with.
    const captured = batch("captured", { knownPaymentIds: ["pay_2"] });
    const payments = [payment("pay_2", "captured")];
    expect(decideCapture(captured, payments)).toEqual({
      kind: "already_captured",
    });
    expect(decideCapture(captured, payments)).toEqual({
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

describe("decideCapture() after a batch is settled (#79)", () => {
  it("sends a second payment on a captured batch's order to review", () => {
    expect(
      decideCapture(batch("captured", { knownPaymentIds: ["pay_1"] }), [
        payment("pay_1", "captured"),
        payment("pay_2", "captured"),
      ])
    ).toEqual({ kind: "extra_captures", paymentIds: ["pay_2"] });
  });

  it("sends a gateway capture on a batch paid offline to review", () => {
    // Paid by cheque: the batch accounts for no gateway payment.
    expect(
      decideCapture(batch("captured"), [payment("pay_1", "captured")])
    ).toEqual({ kind: "extra_captures", paymentIds: ["pay_1"] });
  });

  it("sends each new captured payment on a batch in review to review", () => {
    expect(
      decideCapture(batch("needs_review", { knownPaymentIds: ["pay_1"] }), [
        payment("pay_1", "captured"),
        payment("pay_2", "captured", { amountMinor: 1n }),
        payment("pay_3", "failed"),
        payment("pay_4", "captured"),
      ])
    ).toEqual({ kind: "extra_captures", paymentIds: ["pay_2", "pay_4"] });
  });

  it("never captures a batch in review, even with a payment for the full amount", () => {
    expect(
      decideCapture(batch("needs_review"), [payment("pay_1", "captured")])
    ).toEqual({ kind: "extra_captures", paymentIds: ["pay_1"] });
  });

  it("opens nothing twice: a payment with a review case is known, however often it is told", () => {
    const inReview = batch("needs_review", { knownPaymentIds: ["pay_1"] });
    const payments = [payment("pay_1", "captured")];
    expect(decideCapture(inReview, payments)).toEqual({ kind: "in_review" });
    expect(decideCapture(inReview, payments)).toEqual({ kind: "in_review" });
  });

  it("leaves alone a batch whose review cancelled it, for the payment it reviewed", () => {
    expect(
      decideCapture(batch("cancelled", { knownPaymentIds: ["pay_1"] }), [
        payment("pay_1", "captured"),
      ])
    ).toEqual({ kind: "awaiting_payment" });
  });

  it("ignores payments the batch already accounts for when it captures", () => {
    expect(
      decideCapture(batch("order_created", { knownPaymentIds: ["pay_1"] }), [
        payment("pay_1", "captured"),
        payment("pay_2", "captured"),
        payment("pay_3", "captured"),
      ])
    ).toEqual({
      kind: "capture",
      paymentId: "pay_2",
      otherCapturedIds: ["pay_3"],
    });
  });

  it("still flags money on a superseded batch as not payable", () => {
    expect(
      decideCapture(batch("cancelled"), [payment("pay_7", "captured")])
    ).toEqual({ kind: "not_payable", paymentId: "pay_7" });
  });
});
