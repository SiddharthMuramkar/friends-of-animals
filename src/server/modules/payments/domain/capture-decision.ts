// Whether a payment batch is paid, decided from the gateway's own record of
// its order. Every signal (the Checkout return, a webhook, later a sweep)
// only names the order; the use case then fetches the order's payments
// through the gateway port and applies this decision in one transaction.
// So it never matters in what order the signals arrive, or how often: a
// batch that is already captured stays as it is. Pure; types only.

import type { PaymentBatchStatus } from "./batch-status";

/** A payment attempt on a gateway order, as the gateway port reports it. */
export type GatewayPayment = {
  id: string;
  orderId: string;
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
  amountMinor: bigint;
  /** As the gateway sends it, e.g. "INR". */
  currency: string;
};

/** What the decision needs to know about the batch. */
export type BatchForCapture = {
  status: PaymentBatchStatus;
  /** Null until the gateway has made the order. */
  orderId: string | null;
  amountMinor: bigint;
  currency: "INR";
};

export type CaptureDecision =
  /** Capture the batch with `paymentId`. `otherCapturedIds` were also
   * captured on the same order: a double payment for review (#79). */
  | { kind: "capture"; paymentId: string; otherCapturedIds: string[] }
  /** Nothing to do: the batch was captured before. */
  | { kind: "already_captured" }
  /** Nothing to do yet: no attempt on the order is captured. */
  | { kind: "awaiting_payment" }
  /** A captured payment doesn't match the batch's amount or currency.
   * Never confirm; record it for finance. */
  | { kind: "amount_mismatch"; paymentId: string }
  /** Money arrived for a batch that failed or was cancelled. Never confirm
   * and never refund automatically; it goes to review (#79). */
  | { kind: "not_payable"; paymentId: string };

export function decideCapture(
  batch: BatchForCapture,
  payments: readonly GatewayPayment[]
): CaptureDecision {
  if (batch.status === "captured") return { kind: "already_captured" };
  const captured = payments.filter(
    (payment) =>
      batch.orderId !== null &&
      payment.orderId === batch.orderId &&
      payment.status === "captured"
  );
  const [first] = captured;
  if (!first) return { kind: "awaiting_payment" };

  const matches = (payment: GatewayPayment) =>
    payment.amountMinor === batch.amountMinor &&
    payment.currency === batch.currency;
  const paid = captured.find(matches);
  if (!paid) return { kind: "amount_mismatch", paymentId: first.id };

  if (batch.status !== "order_created") {
    return { kind: "not_payable", paymentId: paid.id };
  }
  return {
    kind: "capture",
    paymentId: paid.id,
    otherCapturedIds: captured
      .filter((payment) => payment !== paid)
      .map((payment) => payment.id),
  };
}
