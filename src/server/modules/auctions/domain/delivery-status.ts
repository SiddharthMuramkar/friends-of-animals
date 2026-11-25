// Getting a sold artwork to its buyer (#133). A delivery starts when the lot
// is sold and waits for the buyer's address. The auction manager dispatches
// it with a courier and tracking number, then marks it delivered. The buyer
// confirms receipt, or the manager records receipt for them once it is
// delivered. The buyer may correct the address until it is dispatched.
//
// Pure: the use cases load the delivery, call `decideDeliveryTransition`,
// then write the new status, its timestamp and an audit row together.
// Loads under plain Node: no imports.

/** The `auction_delivery_status` enum, in order. */
export const DELIVERY_STATUSES = [
  "awaiting_address",
  "pending_dispatch",
  "dispatched",
  "delivered",
  "receipt_confirmed",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_COMMANDS = [
  "save_address",
  "dispatch",
  "update_tracking",
  "mark_delivered",
  "confirm_receipt",
  "record_receipt",
] as const;

export type DeliveryCommand = (typeof DELIVERY_COMMANDS)[number];

/** Who may give each command: the lot's buyer or an auction manager. */
export const DELIVERY_COMMAND_ACTOR: Record<
  DeliveryCommand,
  "buyer" | "manager"
> = {
  save_address: "buyer",
  dispatch: "manager",
  update_tracking: "manager",
  mark_delivered: "manager",
  confirm_receipt: "buyer",
  record_receipt: "manager",
};

const TRANSITIONS: Record<
  DeliveryStatus,
  Partial<Record<DeliveryCommand, DeliveryStatus>>
> = {
  awaiting_address: { save_address: "pending_dispatch" },
  pending_dispatch: {
    save_address: "pending_dispatch",
    dispatch: "dispatched",
  },
  dispatched: {
    update_tracking: "dispatched",
    mark_delivered: "delivered",
    confirm_receipt: "receipt_confirmed",
  },
  delivered: {
    confirm_receipt: "receipt_confirmed",
    record_receipt: "receipt_confirmed",
  },
  receipt_confirmed: {},
};

export type DeliveryTransition =
  | { ok: true; to: DeliveryStatus }
  | { ok: false; error: "address_locked" | "transition_not_allowed" };

/** Where `command` takes a delivery in status `from`, if anywhere. */
export function decideDeliveryTransition(input: {
  from: DeliveryStatus;
  command: DeliveryCommand;
}): DeliveryTransition {
  const to = TRANSITIONS[input.from][input.command];
  if (to) return { ok: true, to };
  if (input.command === "save_address" && input.from !== "awaiting_address") {
    return { ok: false, error: "address_locked" };
  }
  return { ok: false, error: "transition_not_allowed" };
}
