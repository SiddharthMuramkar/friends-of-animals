// What the payments on a donation's gateway order do to it (#106).
// Payments fetches the order's payments from the gateway, locks the
// donation's payment batch and hands them here inside the sync transaction
// (../capture.ts); this decides, and the caller moves the status
// (./donation-status.ts), allocates the receipt, opens review cases and
// starts refunds. It doesn't matter how often or in what order the
// Checkout return and webhooks arrive: a payment the donation already
// accounts for (captured with, in review, or refunded as foreign) is never
// acted on again. Pure; types only.

import type { DonationEvent, DonationStatus } from "./donation-status";

/** A payment attempt on the donation's order, as the gateway reports it. */
export type OrderPayment = {
  id: string;
  orderId: string;
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
  amountMinor: bigint;
  /** As the gateway sends it, e.g. "INR". */
  currency: string;
  /** True when the card or account was issued outside India. */
  international: boolean;
};

/** Why a payment on a donation goes to finance's review (#79). */
export type DonationReviewReason =
  /** Domestic money that isn't the donation's amount, or money in another
   * currency, which refunds can't send: finance refunds it by hand. */
  | "amount_mismatch"
  /** A second payment on a donation that has its money already. */
  | "already_paid"
  /** Money for a donation that expired: finance may still accept it. */
  | "donation_expired";

export type DonationPaymentsDecision = {
  /** The payment that captures the donation, or null. */
  capture: string | null;
  /** Foreign INR payments refunded in full at once, while FCRA is off. */
  refundForeign: OrderPayment[];
  /** Payments for review, never refunded automatically (#55). */
  review: { paymentId: string; reason: DonationReviewReason }[];
  /** How the donation's status moves, if it does. */
  event: DonationEvent | null;
};

/**
 * Whether a payment counts as foreign money. Until the accountant rules
 * (HR-47) both tests apply: a currency other than INR, or an international
 * card or account even when it was charged in INR.
 */
export function isForeignPayment(
  payment: Pick<OrderPayment, "currency" | "international">
): boolean {
  return payment.international || payment.currency.toUpperCase() !== "INR";
}

const isInr = (payment: Pick<OrderPayment, "currency">) =>
  payment.currency.toUpperCase() === "INR";

export function decideDonationPayments(
  donation: { status: DonationStatus; amountMinor: bigint },
  payments: readonly OrderPayment[],
  context: {
    orderId: string;
    knownPaymentIds: readonly string[];
    fcraEnabled: boolean;
  }
): DonationPaymentsDecision {
  const known = new Set(context.knownPaymentIds);
  const onOrder = payments.filter(
    (payment) => payment.orderId === context.orderId
  );
  const fresh = onOrder.filter(
    (payment) => payment.status === "captured" && !known.has(payment.id)
  );
  const refused = (payment: OrderPayment) =>
    !context.fcraEnabled && isForeignPayment(payment);
  // Refunds are INR only: foreign money in another currency goes back from
  // the gateway's dashboard, through review.
  const refundForeign = fresh.filter(
    (payment) => refused(payment) && isInr(payment)
  );
  const domestic = fresh.filter((payment) => !refundForeign.includes(payment));
  const matches = (payment: OrderPayment) =>
    !refused(payment) &&
    isInr(payment) &&
    payment.amountMinor === donation.amountMinor;

  const review: DonationPaymentsDecision["review"] = [];
  let capture: string | null = null;
  switch (donation.status) {
    case "pending":
    case "failed": {
      const paid = domestic.find(matches);
      capture = paid?.id ?? null;
      for (const payment of domestic) {
        if (payment === paid) continue;
        review.push({
          paymentId: payment.id,
          reason: paid ? "already_paid" : "amount_mismatch",
        });
      }
      break;
    }
    case "expired":
      for (const payment of domestic) {
        review.push({
          paymentId: payment.id,
          reason: matches(payment) ? "donation_expired" : "amount_mismatch",
        });
      }
      break;
    default:
      for (const payment of domestic) {
        review.push({ paymentId: payment.id, reason: "already_paid" });
      }
  }

  let event: DonationEvent | null = null;
  if (capture) {
    event = "captured";
  } else if (
    refundForeign.length > 0 &&
    domestic.length === 0 &&
    (donation.status === "pending" ||
      donation.status === "failed" ||
      donation.status === "expired")
  ) {
    event = "foreign_captured";
  } else if (
    fresh.length === 0 &&
    donation.status === "pending" &&
    onOrder.some((payment) => payment.status === "failed") &&
    !onOrder.some((payment) => payment.status === "captured")
  ) {
    event = "payment_failed";
  }
  return { capture, refundForeign, review, event };
}
