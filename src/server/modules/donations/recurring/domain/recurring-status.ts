// The recurring-donation state machine (#107). A monthly donation mirrors
// its gateway subscription: use cases ask this table before every status
// change, and the schema's `recurring_donation_status` enum is built from
// RECURRING_DONATION_STATUSES, with every value in the first migration so
// no later ticket adds one and uses it in the same run. Pure: no database,
// no clock.
//
// Loads under plain Node (drizzle-kit reads the schema that imports it): no
// imports at all.

export const RECURRING_DONATION_STATUSES = [
  /** Created; waiting for the donor to authorise the mandate at Checkout. */
  "pending_authorisation",
  /** The mandate is in place and charges land each month. */
  "active",
  /** A charge failed and the gateway is retrying it. */
  "past_due",
  /** The gateway gave up retrying. Only the donor can revive it there. */
  "halted",
  /** No more charges: the donor, finance, the gateway or the sweeper ended it. Final. */
  "cancelled",
  /** The gateway charged every cycle it was set up for. Final. */
  "completed",
] as const;

export type RecurringDonationStatus =
  (typeof RECURRING_DONATION_STATUSES)[number];

export const RECURRING_DONATION_EVENTS = [
  /** The gateway reports the mandate authorised or the subscription active. */
  "authorised",
  /** A monthly charge was captured. */
  "charged",
  /** A charge failed and the gateway will retry. */
  "charge_failed",
  /** The gateway stopped retrying failed charges. */
  "retries_exhausted",
  /** The gateway confirmed a cancellation (donor, finance or gateway). */
  "cancelled",
  /** The donor never authorised in time (gateway expiry or the sweeper). */
  "authorisation_expired",
  /** The gateway generated the last cycle's charge. */
  "completed",
] as const;

export type RecurringDonationEvent = (typeof RECURRING_DONATION_EVENTS)[number];

export type RecurringDonationTransition =
  | { ok: true; to: RecurringDonationStatus }
  | {
      ok: false;
      reason: "forbidden_transition";
      from: RecurringDonationStatus;
      event: RecurringDonationEvent;
    };

const TRANSITIONS: Readonly<
  Record<
    RecurringDonationStatus,
    Partial<Record<RecurringDonationEvent, RecurringDonationStatus>>
  >
> = {
  pending_authorisation: {
    authorised: "active",
    // The charge can be reported before the authorisation is.
    charged: "active",
    cancelled: "cancelled",
    authorisation_expired: "cancelled",
  },
  active: {
    // Status stays; the charge becomes a new donation.
    charged: "active",
    charge_failed: "past_due",
    // When the retrying signal was missed, the gateway's word still wins.
    retries_exhausted: "halted",
    cancelled: "cancelled",
    completed: "completed",
  },
  past_due: {
    charged: "active",
    // The gateway may reactivate without charging the missed invoice.
    authorised: "active",
    // Each failed retry is reported again.
    charge_failed: "past_due",
    retries_exhausted: "halted",
    cancelled: "cancelled",
  },
  // Razorpay moves a halted subscription back to active when the donor
  // retries or changes the card at Razorpay, so the mirror follows it.
  halted: {
    authorised: "active",
    charged: "active",
    cancelled: "cancelled",
  },
  // A charge that lands after cancellation is refunded, never recorded.
  cancelled: {},
  completed: {},
};

/** Where `event` takes a recurring donation in status `from`, or why it can't. */
export function nextRecurringStatus(
  from: RecurringDonationStatus,
  event: RecurringDonationEvent
): RecurringDonationTransition {
  const to = TRANSITIONS[from][event];
  return to
    ? { ok: true, to }
    : { ok: false, reason: "forbidden_transition", from, event };
}

/** A new recurring donation always waits for the mandate. */
export const INITIAL_RECURRING_STATUS: RecurringDonationStatus =
  "pending_authorisation";

const FINAL: ReadonlySet<RecurringDonationStatus> = new Set([
  "cancelled",
  "completed",
]);

/** True once nothing more will be charged. */
export function isFinalRecurringStatus(
  status: RecurringDonationStatus
): boolean {
  return FINAL.has(status);
}

/**
 * Whether the donor (or finance) may cancel now: anything still able to
 * charge, including a mandate never authorised.
 */
export function canCancelRecurring(status: RecurringDonationStatus): boolean {
  return !FINAL.has(status);
}
