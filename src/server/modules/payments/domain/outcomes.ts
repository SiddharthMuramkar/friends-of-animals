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
  /** A captured payment doesn't match the batch's amount; nothing confirmed. */
  "amount_mismatch",
  /** Money arrived for a batch that failed or was replaced; nothing confirmed. */
  "not_payable",
] as const;

export type SyncOutcome = (typeof SYNC_OUTCOMES)[number];

export const WEBHOOK_OUTCOMES = [...SYNC_OUTCOMES, "ignored"] as const;

export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];
