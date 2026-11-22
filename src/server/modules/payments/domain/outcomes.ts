// What handling a gateway signal did (#77). Every signal (the Checkout
// return, a webhook) syncs its batch against the gateway's record, and the
// sync ends in one of SYNC_OUTCOMES. A stored webhook keeps its outcome:
// a sync outcome, or `ignored` when it named no order of ours. #79 turns
// `not_payable` into a review case.
//
// Loads under plain Node (drizzle-kit reads the schema that imports it): no
// imports at all.

export const SYNC_OUTCOMES = [
  /** The batch was paid in full just now; its registrations are confirmed. */
  "captured",
  /** The batch was paid before; nothing changed. */
  "already_captured",
  /** No payment on the order is captured yet. */
  "awaiting_payment",
  /** Money arrived that the batch can't accept, or the batch is in review
   * already: nothing confirmed, nothing refunded, a case for staff (#79). */
  "needs_review",
] as const;

export type SyncOutcome = (typeof SYNC_OUTCOMES)[number];

export const WEBHOOK_OUTCOMES = [
  ...SYNC_OUTCOMES,
  "ignored",
  /** A refund event (#80) synced one or more of our refunds. */
  "refund_updated",
] as const;

export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];
