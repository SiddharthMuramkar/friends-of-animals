// The payment-batch state machine (#77). A batch is one gateway order for
// one or more registrations: a batch of N for an institution, of one for an
// individual. Pure: no database, no clock. Use cases ask it before every
// status change, and the schema's `payment_batch_status` enum is built from
// PAYMENT_BATCH_STATUSES.
//
// Loads under plain Node (drizzle-kit reads the schema that imports it): no
// imports at all.

export const PAYMENT_BATCH_STATUSES = [
  /** Written with its items, before the gateway is asked for an order. */
  "created",
  /** The gateway made an order; waiting for the payer. */
  "order_created",
  /** Paid: the gateway captured a payment for the full amount, or finance
   * recorded an offline payment (#79). */
  "captured",
  /** The gateway refused to make an order. */
  "failed",
  /** Replaced by a newer batch before anyone paid. */
  "cancelled",
  /** The gateway captured money the batch couldn't accept (#79). Nothing
   * is confirmed or refunded until staff resolve its review case. */
  "needs_review",
] as const;

export type PaymentBatchStatus = (typeof PAYMENT_BATCH_STATUSES)[number];

/** How a captured batch was paid (#79): through the gateway's order, or by
 * an offline payment finance recorded. Null on a batch never captured. */
export const PAYMENT_CAPTURE_METHODS = ["gateway", "offline"] as const;

export type PaymentCaptureMethod = (typeof PAYMENT_CAPTURE_METHODS)[number];

/** What a batch pays for (#106): registrations' fees, or one donation,
 * whose module decides what its payments do (../purposes.ts). Auctions
 * (#133) add theirs, with their handler. */
export const PAYMENT_PURPOSES = [
  "registration_fee",
  "donation",
  "auction_sale",
] as const;

export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const PAYMENT_BATCH_EVENTS = [
  /** The gateway returned an order id. */
  "order_opened",
  /** The gateway refused or failed to create the order. */
  "order_refused",
  /** A payment for the full amount was captured on the batch's order. */
  "captured",
  /** The payer started again over a changed set of registrations. */
  "superseded",
  /** Finance recorded a cheque, bank transfer or cash for the batch (#79). */
  "offline_recorded",
  /** A captured payment couldn't be accepted; a review case opened (#79). */
  "review_opened",
  /** Staff accepted the money: the registrations are confirmed. */
  "review_confirmed",
  /** Staff resolved the case of a batch that was paid before it. */
  "review_cleared",
  /** Staff resolved the case of a batch nobody had paid: it lets go. */
  "review_dismissed",
  /** Its competition was cancelled before anyone paid (#80). */
  "competition_cancelled",
  /** The donation it was opened for expired before anyone paid (#106). */
  "expired",
] as const;

export type PaymentBatchEvent = (typeof PAYMENT_BATCH_EVENTS)[number];

export type PaymentBatchTransition =
  | { ok: true; to: PaymentBatchStatus }
  | {
      ok: false;
      reason: "forbidden_transition";
      from: PaymentBatchStatus;
      event: PaymentBatchEvent;
    };

const TRANSITIONS: Readonly<
  Record<
    PaymentBatchStatus,
    Partial<Record<PaymentBatchEvent, PaymentBatchStatus>>
  >
> = {
  created: {
    order_opened: "order_created",
    order_refused: "failed",
    superseded: "cancelled",
    offline_recorded: "captured",
    competition_cancelled: "cancelled",
    expired: "cancelled",
  },
  order_created: {
    captured: "captured",
    superseded: "cancelled",
    offline_recorded: "captured",
    review_opened: "needs_review",
    competition_cancelled: "cancelled",
    expired: "cancelled",
  },
  // A paid batch stays paid. A second payment opens a case beside it
  // (#80, from #79's review), and refunds are rows of their own, so a
  // batch's refunded part is read from them, not from its status.
  captured: {},
  failed: { review_opened: "needs_review" },
  cancelled: { review_opened: "needs_review" },
  needs_review: {
    review_opened: "needs_review",
    review_confirmed: "captured",
    review_cleared: "captured",
    review_dismissed: "cancelled",
  },
};

/** Where `event` takes a batch in status `from`, or why it can't. */
export function nextPaymentBatchStatus(
  from: PaymentBatchStatus,
  event: PaymentBatchEvent
): PaymentBatchTransition {
  const to = TRANSITIONS[from][event];
  return to
    ? { ok: true, to }
    : { ok: false, reason: "forbidden_transition", from, event };
}

/**
 * Whether a batch in this status still holds its registrations, so no other
 * batch may include them. A paid batch holds them for good; a failed or
 * cancelled one lets them go, so the payer can try again. A batch in review
 * keeps those it held when the case opened, so nobody pays for them twice
 * while staff decide; one that had let them go doesn't take them back.
 */
export function holdsRegistrations(status: PaymentBatchStatus): boolean {
  return status !== "failed" && status !== "cancelled";
}
