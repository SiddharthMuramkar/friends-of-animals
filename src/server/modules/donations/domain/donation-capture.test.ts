import { describe, expect, it } from "vitest";

import {
  type CapturedPayment,
  type DonationForCapture,
  decideDonationCapture,
  isForeignPayment,
} from "./donation-capture";
import { DONATION_STATUSES } from "./donation-status";

const donation = (
  overrides: Partial<DonationForCapture> = {}
): DonationForCapture => ({
  status: "pending",
  amountMinor: 50_000n,
  currency: "INR",
  ...overrides,
});

const payment = (
  overrides: Partial<CapturedPayment> = {}
): CapturedPayment => ({
  id: "pay_1",
  amountMinor: 50_000n,
  currency: "INR",
  international: false,
  ...overrides,
});

const FCRA_OFF = { fcraEnabled: false };
const FCRA_ON = { fcraEnabled: true };

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

describe("decideDonationCapture", () => {
  it.each(["pending", "failed"] as const)(
    "captures a %s donation paid in full in INR",
    (status) => {
      expect(
        decideDonationCapture(donation({ status }), payment(), FCRA_OFF)
      ).toEqual({ kind: "capture", paymentId: "pay_1" });
    }
  );

  it.each([
    "captured",
    "refund_pending",
    "refunded",
    "partially_refunded",
  ] as const)("does nothing for a replay on a %s donation", (status) => {
    expect(
      decideDonationCapture(donation({ status }), payment(), FCRA_OFF)
    ).toEqual({ kind: "already_settled" });
  });

  it("sends money on an expired donation to review", () => {
    expect(
      decideDonationCapture(
        donation({ status: "expired" }),
        payment(),
        FCRA_OFF
      )
    ).toEqual({ kind: "not_payable", paymentId: "pay_1" });
  });

  it("refunds a foreign-currency payment in full while FCRA is off", () => {
    expect(
      decideDonationCapture(
        donation(),
        payment({ currency: "USD", amountMinor: 600n }),
        FCRA_OFF
      )
    ).toEqual({
      kind: "refund_foreign",
      paymentId: "pay_1",
      refund: { amountMinor: 600n, currency: "USD" },
    });
  });

  it("refunds an international card payment in INR while FCRA is off", () => {
    expect(
      decideDonationCapture(
        donation({ status: "failed" }),
        payment({ international: true }),
        FCRA_OFF
      )
    ).toEqual({
      kind: "refund_foreign",
      paymentId: "pay_1",
      refund: { amountMinor: 50_000n, currency: "INR" },
    });
  });

  it("refunds a foreign payment even when the amount is wrong", () => {
    expect(
      decideDonationCapture(
        donation(),
        payment({ international: true, amountMinor: 1n }),
        FCRA_OFF
      )
    ).toMatchObject({ kind: "refund_foreign", refund: { amountMinor: 1n } });
  });

  it("takes an international card payment normally once FCRA is on", () => {
    expect(
      decideDonationCapture(
        donation(),
        payment({ international: true }),
        FCRA_ON
      )
    ).toEqual({ kind: "capture", paymentId: "pay_1" });
  });

  it("never captures another currency, even with FCRA on", () => {
    expect(
      decideDonationCapture(donation(), payment({ currency: "USD" }), FCRA_ON)
    ).toEqual({ kind: "amount_mismatch", paymentId: "pay_1" });
  });

  it.each([49_999n, 50_001n, 0n])(
    "sends a domestic payment of %i paise for a 50,000 paise donation to review",
    (amountMinor) => {
      expect(
        decideDonationCapture(donation(), payment({ amountMinor }), FCRA_OFF)
      ).toEqual({ kind: "amount_mismatch", paymentId: "pay_1" });
    }
  );

  it("decides something for every status", () => {
    for (const status of DONATION_STATUSES) {
      const decision = decideDonationCapture(
        donation({ status }),
        payment(),
        FCRA_OFF
      );
      expect(decision.kind).toBeTypeOf("string");
    }
  });
});
