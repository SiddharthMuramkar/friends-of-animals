// What a captured gateway payment does to an auction payment offer (#133).
// Payments' capture funnel (#77) hands every capture on an auction batch to
// the auction handler, which locks the lot row and asks this function. Only
// a payment for the exact amount, on an open offer of a lot that is waiting
// for payment, sells the lot. The same payment arriving again (webhook
// replay, Checkout return after the webhook) changes nothing. Anything else
// is "not payable" and goes to finance's review queue (#79); it is never
// refunded automatically.
//
// No clock check here: an open offer past its deadline whose expiry job
// hasn't run yet is still payable, because the job itself checks the
// gateway first and would apply this same payment.
//
// Pure. Loads under plain Node.

import type { OfferStatus } from "./payment-offer";

/** The offer behind the captured batch, as the handler reads it. */
export type CaptureOffer = {
  status: OfferStatus;
  amountPaise: bigint;
  /** The gateway payment that paid it, once paid. */
  paidByPaymentId: string | null;
};

export type AuctionCaptureDecision =
  | { outcome: "apply" }
  | { outcome: "duplicate" }
  | { outcome: "amount_mismatch" }
  | {
      outcome: "not_payable";
      reason:
        | "no_offer"
        | "already_paid"
        | "offer_expired"
        | "offer_superseded"
        | "lot_not_awaiting_payment";
    };

export function decideAuctionCapture(input: {
  offer: CaptureOffer | null;
  /** The lot's `auction_lot_status`. */
  lotStatus: string;
  paymentId: string;
  capturedAmountPaise: bigint;
}): AuctionCaptureDecision {
  const { offer } = input;
  if (!offer) return { outcome: "not_payable", reason: "no_offer" };
  switch (offer.status) {
    case "paid":
      return offer.paidByPaymentId === input.paymentId
        ? { outcome: "duplicate" }
        : { outcome: "not_payable", reason: "already_paid" };
    case "expired":
      return { outcome: "not_payable", reason: "offer_expired" };
    case "superseded":
      return { outcome: "not_payable", reason: "offer_superseded" };
    case "open":
      break;
  }
  if (input.lotStatus !== "awaiting_payment") {
    return { outcome: "not_payable", reason: "lot_not_awaiting_payment" };
  }
  if (input.capturedAmountPaise !== offer.amountPaise) {
    return { outcome: "amount_mismatch" };
  }
  return { outcome: "apply" };
}
