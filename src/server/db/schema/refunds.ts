// Refunds (#80): money a payment batch captured, going back. A refund
// lists the batch items it returns (all that are left, or the ones asked
// for); a duplicate returns a second payment of the batch instead. The
// kinds, statuses and methods come from the pure refund machine
// (src/server/payments/domain/refund-status.ts).
//
// Waiting on 77a (the payment tables): `refund.batch_id` and
// `refund_item.batch_item_id` get foreign keys to payment_batch and
// payment_batch_item once those tables exist.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { OFFLINE_PAYMENT_METHODS } from "../../payments/domain/offline-payment";
import {
  REFUND_KINDS,
  REFUND_METHODS,
  REFUND_STATUSES,
} from "../../payments/domain/refund-status";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const refundKind = pgEnum("refund_kind", REFUND_KINDS);
export const refundStatus = pgEnum("refund_status", REFUND_STATUSES);
export const refundMethod = pgEnum("refund_method", REFUND_METHODS);
/** How FOA paid a manual refund back: the ways money arrives offline. */
export const refundManualMethod = pgEnum(
  "refund_manual_method",
  OFFLINE_PAYMENT_METHODS
);

export const refund = pgTable("refund", {
  /** UUIDv7 from the clock. Also names the refund at the gateway. */
  id: uuid().primaryKey(),
  /** The payment batch whose money goes back. */
  batchId: uuid("batch_id").notNull(),
  /** The captured gateway payment refunded; null for a manual refund. */
  gatewayPaymentId: text("gateway_payment_id"),
  kind: refundKind().notNull(),
  status: refundStatus().notNull(),
  method: refundMethod().notNull(),
  /** Bigint paise, like every amount (#55). */
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: text().$type<"INR">().notNull(),
  /** Why it is refunded: the requester's words, or the system's. */
  reason: text().notNull(),
  /** Who asked for a discretionary refund; null for the system's own. */
  requestedBy: uuid("requested_by").references(() => user.id),
  requestedAt: timestamptz("requested_at").notNull(),
  /** Finance's approver or rejecter; null when the system decided. */
  decidedBy: uuid("decided_by").references(() => user.id),
  decidedAt: timestamptz("decided_at"),
  decisionNote: text("decision_note"),
  /**
   * Makes creating a system refund idempotent: a cancellation passes one
   * per batch, a duplicate one per review case. Null for a request.
   */
  idempotencyKey: text("idempotency_key").unique(),
  /** 1 for the first send; each retry of a failed refund adds 1. */
  attempt: integer().notNull().default(1),
  /** The gateway's id for the current attempt, once it is known. */
  gatewayRefundId: text("gateway_refund_id").unique(),
  manualMethod: refundManualMethod("manual_method"),
  /** The transfer reference (UTR), cheque number or cash receipt. */
  manualReference: text("manual_reference"),
  /** When the gateway first accepted the current attempt. */
  sentAt: timestamptz("sent_at"),
  refundedAt: timestamptz("refunded_at"),
  failedAt: timestamptz("failed_at"),
});

export type RefundRow = typeof refund.$inferSelect;

/** One batch item a refund returns, and how much of it. */
export const refundItem = pgTable(
  "refund_item",
  {
    refundId: uuid("refund_id")
      .notNull()
      .references(() => refund.id),
    batchItemId: uuid("batch_item_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** Set when the refund lets the item go (rejected or superseded). */
    releasedAt: timestamptz("released_at"),
  },
  (table) => [primaryKey({ columns: [table.refundId, table.batchItemId] })]
);
