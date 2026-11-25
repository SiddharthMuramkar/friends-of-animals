// The auction lot status machine (#131). A manager drafts a lot from an
// eligible artwork, then schedules it; jobs open it at `opens_at` and close
// it at `closes_at`. A closed lot with no winning bid is settled as unsold.
// A manager may cancel a lot until it closes, and withdrawing auction
// consent cancels any lot that hasn't been settled. Cancelling, or settling
// as unsold, gives the artwork back the status it had before listing.
//
// The enum is defined in full now, so bidding (#132) and payment (#133)
// add transitions, never enum values. Until they land, moves into and out
// of awaiting_payment, sold and relisted are refused.
//
// Pure: the use cases load the lot, call `decideLotTransition`, then write
// the new status, the audit row, the artwork release and the event it
// names, in one transaction.
//
// Loads under plain Node (schema, seed script): no "server-only", no `@/`
// imports.

/** In the order a lot usually meets them. The `auction_lot_status` enum. */
export const LOT_STATUSES = [
  "draft",
  "scheduled",
  "open",
  "closed",
  "awaiting_payment",
  "sold",
  "unsold",
  "relisted",
  "cancelled",
] as const;

export type LotStatus = (typeof LOT_STATUSES)[number];

/**
 * What moves a lot:
 * - `schedule`, `cancel`: an auction manager;
 * - `open`, `close`: the jobs scheduled at `opens_at` and `closes_at`;
 * - `settle_unsold`: the worker, after a lot closed with no winning bid;
 * - `withdraw_consent`: the worker, when the creator's auction consent is
 *   withdrawn.
 */
export const LOT_COMMANDS = [
  "schedule",
  "open",
  "close",
  "settle_unsold",
  "cancel",
  "withdraw_consent",
] as const;

export type LotCommand = (typeof LOT_COMMANDS)[number];

/** The outbox events a move emits. */
export type LotEvent =
  | "auction.lot_opened"
  | "auction.lot_closed"
  | "auction.lot_cancelled";

type Move = { to: LotStatus; event: LotEvent | null };

const CANCEL: Move = { to: "cancelled", event: "auction.lot_cancelled" };

/** Every allowed move. A command missing from a status is refused. */
const TRANSITIONS: Record<LotStatus, Partial<Record<LotCommand, Move>>> = {
  draft: {
    schedule: { to: "scheduled", event: null },
    cancel: CANCEL,
    withdraw_consent: CANCEL,
  },
  scheduled: {
    open: { to: "open", event: "auction.lot_opened" },
    cancel: CANCEL,
    withdraw_consent: CANCEL,
  },
  open: {
    close: { to: "closed", event: "auction.lot_closed" },
    cancel: CANCEL,
    withdraw_consent: CANCEL,
  },
  closed: {
    settle_unsold: { to: "unsold", event: null },
    withdraw_consent: CANCEL,
  },
  awaiting_payment: {},
  sold: {},
  unsold: {},
  relisted: {},
  cancelled: {},
};

/** Where the artwork goes back to the status it had before listing. */
const RESTORING: ReadonlySet<LotStatus> = new Set(["unsold", "cancelled"]);

export type LotTransition =
  | {
      ok: true;
      to: LotStatus;
      event: LotEvent | null;
      /** Give the artwork back `artwork_status_before_listing`. */
      restoresArtwork: boolean;
    }
  | { ok: false; error: "transition_not_allowed" };

/** Where `command` takes a lot in status `from`, if anywhere. */
export function decideLotTransition(input: {
  from: LotStatus;
  command: LotCommand;
}): LotTransition {
  const move = TRANSITIONS[input.from][input.command];
  if (!move) return { ok: false, error: "transition_not_allowed" };
  return { ok: true, ...move, restoresArtwork: RESTORING.has(move.to) };
}

/** Upcoming and open lots: the ones public auction pages list. */
export const PUBLIC_LOT_STATUSES = [
  "scheduled",
  "open",
] as const satisfies readonly LotStatus[];

/**
 * Lots that still hold their artwork. At most one per artwork (a partial
 * unique index over these values; `auction_lot_status` is created whole in
 * one migration, so the predicate may name them).
 */
export const ACTIVE_LOT_STATUSES = LOT_STATUSES.filter(
  (status) => !["sold", "unsold", "cancelled"].includes(status)
);

/** Whether withdrawing auction consent cancels a lot in `status`. */
export function cancelsOnConsentWithdrawal(status: LotStatus): boolean {
  return TRANSITIONS[status].withdraw_consent !== undefined;
}
