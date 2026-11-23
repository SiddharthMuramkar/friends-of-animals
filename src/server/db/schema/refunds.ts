// Refunds (#80): money a payment batch captured, going back.
//
// - refund: one refund of one batch. A discretionary refund (a competition
//   manager or staff admin asked) waits for finance; a cancellation (80b)
//   or a duplicate (a payment review resolved with a refund, #79) is
//   approved the moment it is made. Its kinds, statuses and methods come
//   from the pure machine (src/server/modules/payments/domain/refund-status.ts).
//   Never deleted: money records outlive accounts (HR-31), so a person's
//   id goes to null instead.
// - refund_item: one registration of the batch a refund returns, with the
//   fee it gives back. While `released_at` is null the refund holds the
//   registration, and a partial unique index lets only one refund hold it,
//   so nothing is refunded twice. A rejected refund lets its items go; a
//   refunded one keeps them for good. A duplicate refund returns a second
//   payment, not the batch's fees, so it lists no items.
// - gateway_test_refund lives with the fallback gateway's other tables
//   (./payment-test-gateway.ts).
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { OFFLINE_PAYMENT_METHODS } from "../../modules/payments/domain/offline-payment";
import {
  REFUND_KINDS,
  REFUND_METHODS,
  REFUND_STATUSES,
} from "../../modules/payments/domain/refund-status";
import { user } from "./identity";
import { paymentBatch, paymentBatchItem, paymentReviewCase } from "./payments";
import { registration } from "./registration";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const refundKindEnum = pgEnum("refund_kind", REFUND_KINDS);
export const refundStatusEnum = pgEnum("refund_status", REFUND_STATUSES);
export const refundMethodEnum = pgEnum("refund_method", REFUND_METHODS);
/** How finance paid a manual refund back: the ways money arrives offline. */
export const refundManualMethodEnum = pgEnum(
  "refund_manual_method",
  OFFLINE_PAYMENT_METHODS
);

export const refund = pgTable(
  "refund",
  {
    /** UUIDv7 from the clock. Also names the refund at the gateway. */
    id: uuid().primaryKey(),
    /** The payment batch whose money goes back. */
    batchId: uuid("batch_id")
      .notNull()
      .references(() => paymentBatch.id, { onDelete: "restrict" }),
    /** The review case a duplicate refund settles (#79); null otherwise. */
    reviewCaseId: uuid("review_case_id").references(
      () => paymentReviewCase.id,
      { onDelete: "restrict" }
    ),
    /** The captured gateway payment refunded; null for a manual refund. */
    gatewayPaymentId: text("gateway_payment_id"),
    kind: refundKindEnum().notNull(),
    status: refundStatusEnum().notNull(),
    method: refundMethodEnum().notNull(),
    /** Paise, a bigint end to end (#55). */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** Registrations covered by a whole-batch refund with no paise allocated. */
    zeroShareRegistrationIds: uuid("zero_share_registration_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    currency: char({ length: 3 }).notNull().default("INR"),
    /** Why it is refunded: the requester's words, or the system's. */
    reason: text().notNull(),
    /** Who asked for a discretionary refund; null for the system's own, or
     * once their account is gone. */
    requestedBy: uuid("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamptz("requested_at").notNull(),
    /** Finance's approver or rejecter; null when the kind approved it. */
    decidedBy: uuid("decided_by").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamptz("decided_at"),
    /** Finance's note on approving or rejecting. */
    decisionNote: text("decision_note"),
    /**
     * Makes creating a system refund idempotent: a cancellation passes one
     * per batch, a duplicate one per review case. Null for a request.
     */
    idempotencyKey: text("idempotency_key").unique("refund_idempotency_key"),
    /** 1 for the first send; each retry of a failed refund adds 1. */
    attempt: integer().notNull().default(1),
    /** The gateway's id for the current attempt, once it is known. */
    gatewayRefundId: text("gateway_refund_id").unique(
      "refund_gateway_refund_id"
    ),
    manualMethod: refundManualMethodEnum("manual_method"),
    /** The transfer reference (UTR), cheque number or cash receipt. */
    manualReference: text("manual_reference"),
    /** Who recorded paying a manual refund; null once their account is gone. */
    manualRecordedBy: uuid("manual_recorded_by").references(() => user.id, {
      onDelete: "set null",
    }),
    /** When the gateway first held the current attempt. */
    sentAt: timestamptz("sent_at"),
    refundedAt: timestamptz("refunded_at"),
    failedAt: timestamptz("failed_at"),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check("refund_amount_positive", sql`${table.amountMinor} > 0`),
    // FOA takes and refunds domestic INR only (#55).
    check("refund_currency_inr", sql`${table.currency} = 'INR'`),
    check("refund_attempt_positive", sql`${table.attempt} >= 1`),
    check("refund_reason_present", sql`length(trim(${table.reason})) > 0`),
    // Separation of duties, below the use cases too: nobody decides the
    // refund they asked for.
    check(
      "refund_decider_not_requester",
      sql`${table.requestedBy} IS NULL OR ${table.decidedBy} IS NULL OR ${table.requestedBy} <> ${table.decidedBy}`
    ),
    // A gateway refund goes back to a captured payment; a manual one is
    // paid out by finance.
    check(
      "refund_gateway_has_payment",
      sql`${table.method} <> 'gateway' OR ${table.gatewayPaymentId} IS NOT NULL`
    ),
    check(
      "refund_manual_recorded_when_refunded",
      sql`${table.method} <> 'manual' OR ${table.status} <> 'refunded' OR (${table.manualMethod} IS NOT NULL AND ${table.manualReference} IS NOT NULL)`
    ),
    check(
      "refund_manual_has_no_gateway_refund",
      sql`${table.method} <> 'manual' OR ${table.gatewayRefundId} IS NULL`
    ),
    check(
      "refund_failed_at_when_failed",
      sql`${table.status} <> 'failed' OR ${table.failedAt} IS NOT NULL`
    ),
    check(
      "refund_refunded_at_when_refunded",
      sql`(${table.status} = 'refunded') = (${table.refundedAt} IS NOT NULL)`
    ),
    // A duplicate settles a review case; nothing else does.
    check(
      "refund_case_only_for_duplicates",
      sql`(${table.kind} = 'duplicate') = (${table.reviewCaseId} IS NOT NULL)`
    ),
    index("refund_batch_id_idx").on(table.batchId),
    index("refund_committed_capture_idx")
      .on(table.batchId, table.gatewayPaymentId)
      .where(sql`${table.status} <> 'rejected'`),
    index("refund_live_zero_share_batch_idx")
      .on(table.batchId)
      .where(
        sql`${table.status} <> 'rejected' AND cardinality(${table.zeroShareRegistrationIds}) > 0`
      ),
    index("refund_status_requested_at_idx").on(table.status, table.requestedAt),
    index("refund_requested_at_idx").on(table.requestedAt),
    index("refund_gateway_payment_id_idx").on(table.gatewayPaymentId),
    index("refund_review_case_id_idx").on(table.reviewCaseId),
    // Deleting a user sets these to null; the indexes keep that from scanning.
    index("refund_requested_by_idx").on(table.requestedBy),
    index("refund_decided_by_idx").on(table.decidedBy),
    index("refund_manual_recorded_by_idx").on(table.manualRecordedBy),
  ]
);

export type RefundRow = typeof refund.$inferSelect;

/** The index a second live refund of one registration runs into. */
export const REFUND_ITEM_LIVE_UNIQUE = "refund_item_live_registration_unique";

/** One registration of the batch a refund returns, and its fee. */
export const refundItem = pgTable(
  "refund_item",
  {
    refundId: uuid("refund_id")
      .notNull()
      .references(() => refund.id, { onDelete: "restrict" }),
    batchId: uuid("batch_id").notNull(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registration.id, { onDelete: "restrict" }),
    /** The fee it gives back, in paise: what the batch charged for it. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** Set when the refund lets the item go (rejected or superseded). */
    releasedAt: timestamptz("released_at"),
  },
  (table) => [
    primaryKey({ columns: [table.refundId, table.registrationId] }),
    // An item of the batch the refund is for.
    foreignKey({
      name: "refund_item_batch_item_fk",
      columns: [table.batchId, table.registrationId],
      foreignColumns: [
        paymentBatchItem.batchId,
        paymentBatchItem.registrationId,
      ],
    }).onDelete("restrict"),
    // One live refund at a time holds a registration, and a refunded one
    // holds it for good: nothing is refunded twice.
    uniqueIndex(REFUND_ITEM_LIVE_UNIQUE)
      .on(table.registrationId)
      .where(sql`${table.releasedAt} IS NULL`),
    index("refund_item_batch_id_registration_id_idx").on(
      table.batchId,
      table.registrationId
    ),
    index("refund_item_live_batch_idx")
      .on(table.batchId)
      .where(sql`${table.releasedAt} IS NULL`),
    check("refund_item_amount_positive", sql`${table.amountMinor} > 0`),
  ]
);

export type RefundItemRow = typeof refundItem.$inferSelect;
