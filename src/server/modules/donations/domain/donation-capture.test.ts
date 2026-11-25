import { describe, expect, it } from "vitest";

import {
  decideDonationPayments,
  isForeignPayment,
  type OrderPayment,
} from "./donation-capture";
import { DONATION_STATUSES, type DonationStatus } from "./donation-status";

const payment = (overrides: Partial<OrderPayment> = {}): OrderPayment => ({
  id: "pay_1",
  orderId: "order_1",
  status: "captured",
  amountMinor: 50_000n,
  currency: "INR",
  international: false,
  ...overrides,
});

const decide = (
  status: DonationStatus,
  payments: OrderPayment[],
  { fcraEnabled = false, known = [] as string[] } = {}
) =>
  decideDonationPayments({ status, amountMinor: 50_000n }, payments, {
    orderId: "order_1",
    knownPaymentIds: known,
    fcraEnabled,
  });

describe("isForeignPayment", () => {
  it.each([
    ["a domestic INR payment", payment(), false],
    ["a payment in another currency", payment({ currency: "USD" }), true],
    [
      "an INR payment on an international card",
      payment({ international: true }),
      true,
    ],
    ["lower-case currency codes", payment({ currency: "inr" }), false],
  ])("%s", (_, captured, expected) => {
    expect(isForeignPayment(captured)).toBe(expected);
  });
});

describe("decideDonationPayments", () => {
  it.each(["pending", "failed"] as const)(
    "captures a %s donation paid in full in INR",
    (status) => {
      expect(decide(status, [payment()])).toEqual({
        capture: "pay_1",
        refundForeign: [],
        review: [],
        event: "captured",
      });
    }
  );

  it("does nothing for a replay: the payment is known", () => {
    expect(decide("captured", [payment()], { known: ["pay_1"] })).toEqual({
      capture: null,
      refundForeign: [],
      review: [],
      event: null,
    });
  });

  it("ignores payments on another order and attempts not captured", () => {
    expect(
      decide("pending", [
        payment({ orderId: "order_2" }),
        payment({ id: "pay_2", status: "authorized" }),
      ])
    ).toMatchObject({ capture: null, event: null });
  });

  it("marks a pending donation failed when only failed attempts exist", () => {
    expect(decide("pending", [payment({ status: "failed" })])).toMatchObject({
      capture: null,
      event: "payment_failed",
    });
  });

  it("sends money on an expired donation to review, never capturing it", () => {
    expect(decide("expired", [payment()])).toEqual({
      capture: null,
      refundForeign: [],
      review: [{ paymentId: "pay_1", reason: "donation_expired" }],
      event: null,
    });
  });

  it.each(["captured", "refunded", "partially_refunded"] as const)(
    "reviews a second domestic payment on a %s donation",
    (status) => {
      expect(
        decide(status, [payment({ id: "pay_2" })], { known: ["pay_1"] })
      ).toMatchObject({
        capture: null,
        review: [{ paymentId: "pay_2", reason: "already_paid" }],
        event: null,
      });
    }
  );

  it("refunds an international card payment in INR while FCRA is off", () => {
    const foreign = payment({ international: true });
    expect(decide("pending", [foreign])).toEqual({
      capture: null,
      refundForeign: [foreign],
      review: [],
      event: "foreign_captured",
    });
  });

  it("refunds a foreign payment even when the amount is wrong", () => {
    const foreign = payment({ international: true, amountMinor: 1n });
    expect(decide("failed", [foreign])).toMatchObject({
      refundForeign: [foreign],
      event: "foreign_captured",
    });
  });

  it("refunds foreign money that lands on an expired donation", () => {
    expect(decide("expired", [payment({ international: true })])).toMatchObject(
      { event: "foreign_captured", review: [] }
    );
  });

  it("refunds a second, foreign payment without touching a captured donation", () => {
    const foreign = payment({ id: "pay_2", international: true });
    expect(decide("captured", [foreign], { known: ["pay_1"] })).toEqual({
      capture: null,
      refundForeign: [foreign],
      review: [],
      event: null,
    });
  });

  it("reviews foreign money in another currency, which refunds can't send", () => {
    expect(
      decide("pending", [payment({ currency: "USD", amountMinor: 600n })])
    ).toEqual({
      capture: null,
      refundForeign: [],
      review: [{ paymentId: "pay_1", reason: "amount_mismatch" }],
      event: null,
    });
  });

  it("takes an international card payment normally once FCRA is on", () => {
    expect(
      decide("pending", [payment({ international: true })], {
        fcraEnabled: true,
      })
    ).toMatchObject({ capture: "pay_1", event: "captured" });
  });

  it("never captures another currency, even with FCRA on", () => {
    expect(
      decide("pending", [payment({ currency: "USD" })], { fcraEnabled: true })
    ).toMatchObject({
      capture: null,
      review: [{ paymentId: "pay_1", reason: "amount_mismatch" }],
    });
  });

  it.each([49_999n, 50_001n])(
    "reviews a domestic payment of %i paise for a 50,000 paise donation",
    (amountMinor) => {
      expect(decide("pending", [payment({ amountMinor })])).toMatchObject({
        capture: null,
        review: [{ paymentId: "pay_1", reason: "amount_mismatch" }],
        event: null,
      });
    }
  );

  it("captures with the matching payment and reviews the other", () => {
    expect(
      decide("pending", [
        payment({ id: "pay_1", amountMinor: 1n }),
        payment({ id: "pay_2" }),
      ])
    ).toMatchObject({
      capture: "pay_2",
      review: [{ paymentId: "pay_1", reason: "already_paid" }],
    });
  });

  it("decides something for every status", () => {
    for (const status of DONATION_STATUSES) {
      expect(decide(status, [payment()]).review.length).toBeLessThanOrEqual(1);
    }
  });
});
