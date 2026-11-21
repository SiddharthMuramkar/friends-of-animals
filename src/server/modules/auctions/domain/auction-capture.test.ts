import { describe, expect, it } from "vitest";

import { decideAuctionCapture, type CaptureOffer } from "./auction-capture";

const openOffer: CaptureOffer = {
  status: "open",
  amountPaise: 220_000n,
  paidByPaymentId: null,
};

describe("decideAuctionCapture", () => {
  it("applies a full payment on an open offer while the lot awaits payment", () => {
    expect(
      decideAuctionCapture({
        offer: openOffer,
        lotStatus: "awaiting_payment",
        paymentId: "pay_1",
        capturedAmountPaise: 220_000n,
      })
    ).toEqual({ outcome: "apply" });
  });

  it("treats the same payment arriving again as a duplicate", () => {
    expect(
      decideAuctionCapture({
        offer: { ...openOffer, status: "paid", paidByPaymentId: "pay_1" },
        lotStatus: "sold",
        paymentId: "pay_1",
        capturedAmountPaise: 220_000n,
      })
    ).toEqual({ outcome: "duplicate" });
  });

  it("sends a second, different payment on a paid offer to review", () => {
    expect(
      decideAuctionCapture({
        offer: { ...openOffer, status: "paid", paidByPaymentId: "pay_1" },
        lotStatus: "sold",
        paymentId: "pay_2",
        capturedAmountPaise: 220_000n,
      })
    ).toEqual({ outcome: "not_payable", reason: "already_paid" });
  });

  it("sends a payment on an expired offer to review", () => {
    expect(
      decideAuctionCapture({
        offer: { ...openOffer, status: "expired" },
        lotStatus: "awaiting_payment",
        paymentId: "pay_1",
        capturedAmountPaise: 220_000n,
      })
    ).toEqual({ outcome: "not_payable", reason: "offer_expired" });
  });

  it("sends a payment on a superseded offer to review", () => {
    expect(
      decideAuctionCapture({
        offer: { ...openOffer, status: "superseded" },
        lotStatus: "cancelled",
        paymentId: "pay_1",
        capturedAmountPaise: 220_000n,
      })
    ).toEqual({ outcome: "not_payable", reason: "offer_superseded" });
  });

  it("sends a payment with no offer behind its batch to review", () => {
    expect(
      decideAuctionCapture({
        offer: null,
        lotStatus: "awaiting_payment",
        paymentId: "pay_1",
        capturedAmountPaise: 220_000n,
      })
    ).toEqual({ outcome: "not_payable", reason: "no_offer" });
  });

  it("sends a payment on an open offer of a lot that no longer awaits payment to review", () => {
    expect(
      decideAuctionCapture({
        offer: openOffer,
        lotStatus: "cancelled",
        paymentId: "pay_1",
        capturedAmountPaise: 220_000n,
      })
    ).toEqual({ outcome: "not_payable", reason: "lot_not_awaiting_payment" });
  });

  it("applies nothing when the captured amount differs from the offer", () => {
    for (const captured of [219_999n, 220_001n]) {
      expect(
        decideAuctionCapture({
          offer: openOffer,
          lotStatus: "awaiting_payment",
          paymentId: "pay_1",
          capturedAmountPaise: captured,
        })
      ).toEqual({ outcome: "amount_mismatch" });
    }
  });
});
