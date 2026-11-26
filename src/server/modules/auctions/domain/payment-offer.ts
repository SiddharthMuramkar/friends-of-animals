// The payment offer a lot's winner gets when it closes (#133). An offer is
// open for the payment window; paying it sells the lot. If the window
// passes unpaid it expires and the lot may pass to the next bidder (see
// award.ts). If the lot is cancelled while the offer is open (the creator
// withdrew auction consent), the offer is superseded. Nothing leaves a
// paid, expired or superseded offer: a payment that lands on one goes to
// finance's review queue, and is never refunded automatically.
//
// Pure: times come from the injected clock. Loads under plain Node: no
// imports.

/** The `auction_payment_offer_status` enum. */
export const OFFER_STATUSES = [
  "open",
  "paid",
  "expired",
  "superseded",
] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];

/**
 * What moves an offer:
 * - `captured`: the gateway captured the full amount on the offer's order;
 * - `window_passed`: the expiry job ran after the deadline, unpaid;
 * - `lot_withdrawn`: the lot was cancelled while the offer was open.
 */
export const OFFER_EVENTS = [
  "captured",
  "window_passed",
  "lot_withdrawn",
] as const;

export type OfferEvent = (typeof OFFER_EVENTS)[number];

const TRANSITIONS: Record<
  OfferStatus,
  Partial<Record<OfferEvent, OfferStatus>>
> = {
  open: {
    captured: "paid",
    window_passed: "expired",
    lot_withdrawn: "superseded",
  },
  paid: {},
  expired: {},
  superseded: {},
};

export type OfferTransition =
  | { ok: true; to: OfferStatus }
  | { ok: false; error: "transition_not_allowed" };

/** Where `event` takes an offer in status `from`, if anywhere. */
export function decideOfferTransition(input: {
  from: OfferStatus;
  event: OfferEvent;
}): OfferTransition {
  const to = TRANSITIONS[input.from][input.event];
  return to ? { ok: true, to } : { ok: false, error: "transition_not_allowed" };
}

/** The setting `auctions.paymentWindowHours`: its default and bounds. */
export const PAYMENT_WINDOW_HOURS = { default: 72, min: 1, max: 336 } as const;

/** The setting `auctions.maxPaymentOffers`: the winner plus fallbacks. */
export const MAX_PAYMENT_OFFERS = { default: 3, min: 1, max: 10 } as const;

const HOUR_MS = 60 * 60 * 1000;

/** When an offer made at `offeredAt` stops being payable. */
export function offerExpiresAt(offeredAt: Date, windowHours: number): Date {
  if (
    !Number.isInteger(windowHours) ||
    windowHours < PAYMENT_WINDOW_HOURS.min ||
    windowHours > PAYMENT_WINDOW_HOURS.max
  ) {
    throw new RangeError(
      `A payment window must be ${PAYMENT_WINDOW_HOURS.min} to ${PAYMENT_WINDOW_HOURS.max} whole hours`
    );
  }
  return new Date(offeredAt.getTime() + windowHours * HOUR_MS);
}

/**
 * Whether the expiry job should act on an offer at `now`: it is still open
 * and its deadline has come. The job checks the gateway for a payment first,
 * so a payer finishing checkout at the deadline isn't failed.
 */
export function isOfferDue(
  offer: { status: OfferStatus; expiresAt: Date },
  now: Date
): boolean {
  return offer.status === "open" && now.getTime() >= offer.expiresAt.getTime();
}
