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
  /** The gateway captured a payment for the full amount. */
  "captured",
  /** The gateway refused to make an order. */
  "failed",
  /** Replaced by a newer batch before anyone paid. */
  "cancelled",
] as const;

export type PaymentBatchStatus = (typeof PAYMENT_BATCH_STATUSES)[number];

export const PAYMENT_BATCH_EVENTS = [
  /** The gateway returned an order id. */
  "order_opened",
  /** The gateway refused or failed to create the order. */
  "order_refused",
  /** A payment for the full amount was captured on the batch's order. */
  "captured",
  /** The payer started again over a changed set of registrations. */
  "superseded",
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
  },
  order_created: {
    captured: "captured",
    superseded: "cancelled",
  },
  // Refunds (#80) and the review case for late captures (#79) add their
  // moves here.
  captured: {},
  failed: {},
  cancelled: {},
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
 * cancelled one lets them go, so the payer can try again.
 */
export function holdsRegistrations(status: PaymentBatchStatus): boolean {
  return status !== "failed" && status !== "cancelled";
}
