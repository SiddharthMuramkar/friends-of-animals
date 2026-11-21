// What to do with a refund, decided from the gateway's own record of the
// payment's refunds (#80). Approval, a cancellation, a retry and every
// refund webhook only name the refund; the use case lists the payment's
// refunds through the gateway port and applies this decision in one
// transaction. Because a refund the gateway already holds is adopted, never
// sent again, a lost response or a replayed webhook can't pay twice. Pure;
// types only.

import type { RefundEvent, RefundStatus } from "./refund-status";

/** A refund on a captured payment, as the gateway port reports it. */
export type GatewayRefund = {
  id: string;
  paymentId: string;
  amountMinor: bigint;
  /** As the gateway sends it, e.g. "INR". */
  currency: string;
  status: "pending" | "processed" | "failed";
  /** What we sent with it: see `refundNotes`. */
  notes: Readonly<Record<string, string>>;
};

/** What the decision needs to know about our refund. */
export type RefundForSync = {
  id: string;
  status: RefundStatus;
  /** Manual refunds are paid out by finance, never through the gateway. */
  method: "gateway" | "manual";
  /** 1 for the first send; finance's retry of a failed refund adds 1. */
  attempt: number;
  /** The gateway's id for this attempt, once known. */
  gatewayRefundId: string | null;
  /** The captured gateway payment the money goes back to. */
  paymentId: string;
  amountMinor: bigint;
  currency: "INR";
};

type Attempt = Pick<RefundForSync, "id" | "attempt">;

/** The notes each gateway refund carries, naming our refund and attempt. */
export function refundNotes(refund: Attempt): Record<string, string> {
  return { refundId: refund.id, attempt: String(refund.attempt) };
}

/** The gateway idempotency key: one per refund attempt. */
export function refundIdempotencyKey(refund: Attempt): string {
  return `${refund.id}-${refund.attempt}`;
}

export type RefundSyncDecision =
  /** Approved and unknown to the gateway: call its refund now. */
  | { kind: "send" }
  /** Move the refund with `event` and remember the gateway's id. */
  | { kind: "apply"; event: RefundEvent; gatewayRefundId: string }
  /** Nothing new. */
  | { kind: "unchanged" }
  /** The gateway's refund is for another amount or currency. Never apply
   * it; record it for finance. */
  | { kind: "amount_mismatch"; gatewayRefundId: string }
  /** Sent, but the gateway doesn't list it. Record it for finance. */
  | { kind: "missing_at_gateway" }
  /** Approved, to be paid out by hand: finance records it. */
  | { kind: "awaiting_manual" };

const EVENT_FOR: Readonly<Record<GatewayRefund["status"], RefundEvent>> = {
  pending: "sent",
  processed: "processed",
  failed: "gateway_failed",
};

export function decideRefundSync(
  refund: RefundForSync,
  atGateway: readonly GatewayRefund[]
): RefundSyncDecision {
  if (refund.status !== "approved" && refund.status !== "processing") {
    return { kind: "unchanged" };
  }
  if (refund.method === "manual") return { kind: "awaiting_manual" };

  const notes = refundNotes(refund);
  const ours = atGateway.find(
    (candidate) =>
      candidate.paymentId === refund.paymentId &&
      (candidate.id === refund.gatewayRefundId ||
        (candidate.notes.refundId === notes.refundId &&
          candidate.notes.attempt === notes.attempt))
  );
  if (!ours) {
    return refund.status === "approved"
      ? { kind: "send" }
      : { kind: "missing_at_gateway" };
  }

  if (
    ours.amountMinor !== refund.amountMinor ||
    ours.currency !== refund.currency
  ) {
    return { kind: "amount_mismatch", gatewayRefundId: ours.id };
  }

  const event = EVENT_FOR[ours.status];
  if (refund.status === "processing" && event === "sent") {
    return { kind: "unchanged" };
  }
  return { kind: "apply", event, gatewayRefundId: ours.id };
}
