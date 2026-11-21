// What a captured payment does to its donation (#106). Payments fetches the
// order's payments from the gateway, picks the captured one and hands it
// here inside the capture transaction; this decides, and the use case then
// moves the status (./donation-status.ts), allocates the receipt, posts to
// the ledger and writes the outbox. It doesn't matter how often or in what
// order the Checkout return and webhooks arrive: a settled donation stays
// as it is. Pure; types only.

import type { DonationStatus } from "./donation-status";

/** The donation as the decision needs it. */
export type DonationForCapture = {
  status: DonationStatus;
  amountMinor: bigint;
  currency: "INR";
};

/** A captured payment as the gateway reports it. */
export type CapturedPayment = {
  id: string;
  amountMinor: bigint;
  /** As the gateway sends it, e.g. "INR". */
  currency: string;
  /** True when the card or account was issued outside India. */
  international: boolean;
};

export type DonationCaptureDecision =
  /** Domestic INR for the full amount: capture and allocate a receipt. */
  | { kind: "capture"; paymentId: string }
  /**
   * Money from abroad while FOA can't accept it (FCRA off): refund all of
   * it, in the currency it came in, and issue no receipt.
   */
  | {
      kind: "refund_foreign";
      paymentId: string;
      refund: { amountMinor: bigint; currency: string };
    }
  /** A replay, or a later signal for a settled donation: change nothing. */
  | { kind: "already_settled" }
  /** Domestic money that doesn't match the donation: finance reviews it. */
  | { kind: "amount_mismatch"; paymentId: string }
  /**
   * Money for a donation that can no longer be paid (expired): finance
   * reviews it, never an automatic refund (#55).
   */
  | { kind: "not_payable"; paymentId: string };

/**
 * Whether a payment counts as foreign money. Until the accountant rules
 * (HR-47) both tests apply: a currency other than INR, or an international
 * card or account even when it was charged in INR.
 */
export function isForeignPayment(
  payment: Pick<CapturedPayment, "currency" | "international">
): boolean {
  return payment.international || payment.currency.toUpperCase() !== "INR";
}

const SETTLED: ReadonlySet<DonationStatus> = new Set([
  "captured",
  "refund_pending",
  "refunded",
  "partially_refunded",
]);

export function decideDonationCapture(
  donation: DonationForCapture,
  payment: CapturedPayment,
  org: { fcraEnabled: boolean }
): DonationCaptureDecision {
  if (SETTLED.has(donation.status)) return { kind: "already_settled" };
  if (donation.status === "expired") {
    return { kind: "not_payable", paymentId: payment.id };
  }
  // Before the amount check: a foreign payment is refused whatever it is
  // for, and another currency never matches an INR amount anyway.
  if (!org.fcraEnabled && isForeignPayment(payment)) {
    return {
      kind: "refund_foreign",
      paymentId: payment.id,
      refund: { amountMinor: payment.amountMinor, currency: payment.currency },
    };
  }
  const matches =
    payment.currency.toUpperCase() === donation.currency &&
    payment.amountMinor === donation.amountMinor;
  return matches
    ? { kind: "capture", paymentId: payment.id }
    : { kind: "amount_mismatch", paymentId: payment.id };
}
