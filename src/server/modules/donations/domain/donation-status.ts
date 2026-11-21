// The donation state machine (#106). Use cases ask it before every status
// change, and the schema's `donation_status` enum is built from
// DONATION_STATUSES, with every value in the first migration so no later
// ticket adds one and uses it in the same run. Pure: no database, no clock.
//
// Loads under plain Node (drizzle-kit reads the schema that imports it): no
// imports at all.

export const DONATION_STATUSES = [
  /** An online donation waiting for the donor to pay at Checkout. */
  "pending",
  /** Money received; the donation has its receipt. */
  "captured",
  /** The payment attempt failed. The same order may still be paid. */
  "failed",
  /** Checkout was never completed in time. Final. */
  "expired",
  /** A refund was sent to the gateway and hasn't been processed yet. */
  "refund_pending",
  /** The whole amount went back. Final. */
  "refunded",
  /** Part of the amount went back. */
  "partially_refunded",
] as const;

export type DonationStatus = (typeof DONATION_STATUSES)[number];

export const DONATION_EVENTS = [
  /** A domestic INR payment for the full amount was captured. */
  "captured",
  /** The gateway reported a failed attempt on the donation's order. */
  "payment_failed",
  /** The expiry job found Checkout unfinished past the deadline. */
  "checkout_expired",
  /**
   * A payment from abroad was captured while FOA can't accept foreign
   * money (FCRA off): it is refunded in full and never gets a receipt.
   */
  "foreign_captured",
  /** A refund approved by finance (or a system refund) was sent. */
  "refund_requested",
  /** The gateway processed a refund of the whole remaining amount. */
  "refund_processed_in_full",
  /** The gateway processed a refund of part of the amount. */
  "refund_processed_in_part",
] as const;

export type DonationEvent = (typeof DONATION_EVENTS)[number];

export type DonationTransition =
  | { ok: true; to: DonationStatus }
  | {
      ok: false;
      reason: "forbidden_transition";
      from: DonationStatus;
      event: DonationEvent;
    };

const TRANSITIONS: Readonly<
  Record<DonationStatus, Partial<Record<DonationEvent, DonationStatus>>>
> = {
  pending: {
    captured: "captured",
    payment_failed: "failed",
    checkout_expired: "expired",
    foreign_captured: "refund_pending",
  },
  // A later attempt on the same order can still succeed, or come from
  // abroad.
  failed: {
    captured: "captured",
    foreign_captured: "refund_pending",
  },
  captured: {
    refund_requested: "refund_pending",
  },
  refund_pending: {
    refund_processed_in_full: "refunded",
    refund_processed_in_part: "partially_refunded",
  },
  // Finance may refund the rest later.
  partially_refunded: {
    refund_requested: "refund_pending",
  },
  refunded: {},
  // Money that lands on an expired donation goes to review, never to
  // captured: the donor starts a new checkout.
  expired: {},
};

/** Where `event` takes a donation in status `from`, or why it can't. */
export function nextDonationStatus(
  from: DonationStatus,
  event: DonationEvent
): DonationTransition {
  const to = TRANSITIONS[from][event];
  return to
    ? { ok: true, to }
    : { ok: false, reason: "forbidden_transition", from, event };
}

/** How a donation comes into being. */
export type DonationOrigin =
  /** The donate page: pending until Checkout captures it (#106). */
  | "online_checkout"
  /** Finance records money already received (#108). */
  | "offline_entry"
  /** A recurring donation's charge landed (#107). */
  | "recurring_charge";

/** The status a new donation is written with. */
export function initialDonationStatus(origin: DonationOrigin): DonationStatus {
  return origin === "online_checkout" ? "pending" : "captured";
}

/**
 * Whether this move takes the next receipt number. Only a domestic capture
 * does, from pending or failed, or a donation born captured (`from` null),
 * so failed and foreign payments never use up a number.
 */
export function allocatesReceipt(
  from: DonationStatus | null,
  event: DonationEvent
): boolean {
  if (event !== "captured") return false;
  return from === null || from === "pending" || from === "failed";
}
