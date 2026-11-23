// The refund state machine (#80). A refund returns some or all of what a
// payment batch captured. A discretionary refund waits for finance; a
// cancellation or duplicate refund is approved the moment it is made. Pure:
// no database, no clock. The schema's `refund_status`, `refund_kind` and
// `refund_method` enums are built from these lists.
//
// Loads under plain Node (drizzle-kit reads the schema that imports it): no
// imports at all.

export const REFUND_KINDS = [
  /** Asked for by a competition manager or staff admin; finance decides. */
  "discretionary",
  /** The competition was cancelled: every paid fee goes back. */
  "cancellation",
  /** The payer paid twice; the extra payment goes back. */
  "duplicate",
] as const;

export type RefundKind = (typeof REFUND_KINDS)[number];

export const REFUND_STATUSES = [
  /** Waiting for finance to approve or reject it. */
  "requested",
  /** Approved, by finance or by its kind; not yet at the gateway. */
  "approved",
  /** Finance declined it, or a cancellation superseded it. */
  "rejected",
  /** The gateway accepted it and hasn't finished. */
  "processing",
  /** The money went back: through the gateway, or paid out by hand. */
  "refunded",
  /** The gateway gave up on it. Finance may send it again. */
  "failed",
] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_METHODS = [
  /** Back to the captured payment, through the gateway. */
  "gateway",
  /** The batch was paid offline: FOA pays it back by hand, and finance
   * records how. */
  "manual",
] as const;

export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_EVENTS = [
  /** Finance approved a requested refund. */
  "approved",
  /** Finance declined it, closed a failed one, or a cancellation took over. */
  "rejected",
  /** The gateway accepted the refund and is still working on it. */
  "sent",
  /** The gateway processed it, or finance recorded paying it out by hand. */
  "processed",
  /** The gateway reported that the refund failed. */
  "gateway_failed",
  /** Finance sent a failed refund again. */
  "retried",
] as const;

export type RefundEvent = (typeof REFUND_EVENTS)[number];

export type RefundTransition =
  | { ok: true; to: RefundStatus }
  | {
      ok: false;
      reason: "forbidden_transition";
      from: RefundStatus;
      event: RefundEvent;
    };

const TRANSITIONS: Readonly<
  Record<RefundStatus, Partial<Record<RefundEvent, RefundStatus>>>
> = {
  requested: { approved: "approved", rejected: "rejected" },
  approved: {
    sent: "processing",
    processed: "refunded",
    gateway_failed: "failed",
  },
  processing: { processed: "refunded", gateway_failed: "failed" },
  failed: { retried: "approved", rejected: "rejected" },
  rejected: {},
  refunded: {},
};

/** Where `event` takes a refund in status `from`, or why it can't. */
export function nextRefundStatus(
  from: RefundStatus,
  event: RefundEvent
): RefundTransition {
  const to = TRANSITIONS[from][event];
  return to
    ? { ok: true, to }
    : { ok: false, reason: "forbidden_transition", from, event };
}

/**
 * The status a new refund starts in. Only a discretionary refund needs
 * finance's approval; nothing else can skip it, because no other kind can
 * be asked for by a person.
 */
export function initialRefundStatus(kind: RefundKind): RefundStatus {
  return kind === "discretionary" ? "requested" : "approved";
}

/**
 * Whether a refund in this status holds its batch items, so no other refund
 * may include them. A failed refund keeps them: finance may send it again.
 */
export function holdsItems(status: RefundStatus): boolean {
  return status !== "rejected";
}

export type RefundDecisionCheck =
  | { ok: true }
  | { ok: false; reason: "not_requested" | "same_person" };

/**
 * Whether `deciderId` may approve or reject this refund. Only a requested
 * refund is decided, and never by the person who asked for it.
 */
export function checkRefundDecision(
  refund: { status: RefundStatus; requestedBy: string | null },
  deciderId: string
): RefundDecisionCheck {
  if (refund.status !== "requested") {
    return { ok: false, reason: "not_requested" };
  }
  if (refund.requestedBy === deciderId) {
    return { ok: false, reason: "same_person" };
  }
  return { ok: true };
}
