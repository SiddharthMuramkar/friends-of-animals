// The donation state machine (#106). Use cases ask it before every status
// change, and the schema's `donation_status` enum is built from
// DONATION_STATUSES, with every value in the first migration (ADR 0004), so
// recurring (#107) and offline (#108) donations add no value of their own.
// Pure: no database, no clock.
//
// Loads under plain Node (drizzle-kit reads the schema that imports it): no
// imports at all.

export const DONATION_STATUSES = [
  /** An online donation waiting for the donor to pay at Checkout. */
  "pending",
  /** Money received; the donation has its receipt. */
  "captured",
  /** A payment attempt failed. The same order may still be paid. */
  "failed",
  /** Checkout wasn't finished in time. Money that lands later goes to
   * review, where finance may still accept it. */
  "expired",
  /** Money from abroad arrived while FOA can't accept it (FCRA off): the
   * system refunds it, and the donation has no receipt. */
  "refund_pending",
  /** All of the money went back. Final. */
  "refunded",
  /** Part of the money went back; the rest may follow. */
  "partially_refunded",
] as const;

export type DonationStatus = (typeof DONATION_STATUSES)[number];

export const DONATION_EVENTS = [
  /** A domestic INR payment for the full amount was captured. */
  "captured",
  /** The gateway reported a failed attempt and nothing is captured. */
  "payment_failed",
  /** The expiry job found Checkout unfinished past the deadline. */
  "checkout_expired",
  /**
   * A payment from abroad was captured while FOA can't accept foreign
   * money (FCRA off): it is refunded in full and never gets a receipt.
   */
  "foreign_captured",
  /** Finance accepted, in review, money that arrived after expiry. */
  "late_capture_accepted",
  /** A refund of everything left of the donation was processed. */
  "refund_processed_in_full",
  /** A refund of part of what is left was processed. */
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
  // abroad, until the donation expires.
  failed: {
    captured: "captured",
    checkout_expired: "expired",
    foreign_captured: "refund_pending",
  },
  // Money that lands on an expired donation never captures it by itself:
  // it goes to review (#79), and only finance accepting it does. Foreign
  // money goes back whatever the donation's status.
  expired: {
    late_capture_accepted: "captured",
    foreign_captured: "refund_pending",
  },
  captured: {
    refund_processed_in_full: "refunded",
    refund_processed_in_part: "partially_refunded",
  },
  partially_refunded: {
    refund_processed_in_full: "refunded",
    refund_processed_in_part: "partially_refunded",
  },
  refund_pending: { refund_processed_in_full: "refunded" },
  refunded: {},
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

/** How a donation comes into being. Every value is in the first
 * migration: #107 and #108 start their donations with theirs. */
export const DONATION_ORIGINS = [
  /** The donate page: pending until Checkout captures it (#106). */
  "online_checkout",
  /** Finance records money already received (#108). */
  "offline_entry",
  /** A recurring donation's charge landed (#107). */
  "recurring_charge",
] as const;

export type DonationOrigin = (typeof DONATION_ORIGINS)[number];

/** The status a new donation is written with. */
export function initialDonationStatus(origin: DonationOrigin): DonationStatus {
  return origin === "online_checkout" ? "pending" : "captured";
}

/**
 * Whether this move takes the next receipt number: a domestic capture, or
 * finance accepting late money, or a donation born captured (`from` null).
 * Failed and foreign payments never use up a number.
 */
export function allocatesReceipt(
  from: DonationStatus | null,
  event: DonationEvent
): boolean {
  if (from === null) return event === "captured";
  const to = nextDonationStatus(from, event);
  return to.ok && to.to === "captured";
}

/** Statuses whose donation holds money FOA kept, with its receipt. */
export function holdsMoney(status: DonationStatus): boolean {
  return status === "captured" || status === "partially_refunded";
}
