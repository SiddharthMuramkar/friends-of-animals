// Payments (#77). A payment batch is one gateway order for one or more
// registrations: a coordinator's batch of N, later an adult's batch of one
// (#78).
//
// - payment_batch: the order, its total in paise and its status
//   (src/server/modules/payments/domain/batch-status.ts). Never deleted: payment
//   records outlive accounts (HR-31), so the payer goes to null instead.
// - payment_batch_item: one row per registration, with the fee it was
//   charged. While `released_at` is null the batch holds the registration,
//   and a partial unique index lets only one batch hold it at a time. The
//   index predicate names no status, so later statuses (#79, #80) need no
//   change to it.
// - gateway_webhook_event: one row per webhook whose signature checked out,
//   to drop replays and keep what each led to. Never the raw payload: it
//   carries the payer's email and phone.
// - offline_payment (#79): the cheque, bank transfer or cash finance
//   recorded a batch as paid with, and its proof file. One per batch.
// - payment_review_case (#79): a captured payment the batch couldn't
//   accept, kept for staff to resolve with an outcome and a reason. One
//   per payment, so a replayed signal opens nothing twice.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  PAYMENT_BATCH_STATUSES,
  PAYMENT_CAPTURE_METHODS,
  PAYMENT_PURPOSES,
} from "../../modules/payments/domain/batch-status";
import { OFFLINE_PAYMENT_METHODS } from "../../modules/payments/domain/offline-payment";
import { WEBHOOK_OUTCOMES } from "../../modules/payments/domain/outcomes";
import {
  PAYMENT_REVIEW_OUTCOMES,
  PAYMENT_REVIEW_REASONS,
} from "../../modules/payments/domain/review-case";
import { GATEWAY_NAMES } from "../../ports/payment-gateway";
import { competition } from "./competitions";
import { participationRouteEnum } from "./competition-terms";
import { fileAsset } from "./files";
import { user } from "./identity";
import { institution } from "./institutions";
import { institutionRegistration, registration } from "./registration";

/** #79 and #80 add their statuses, each in its own migration. */
export const paymentBatchStatusEnum = pgEnum(
  "payment_batch_status",
  PAYMENT_BATCH_STATUSES
);

/** #79: how a captured batch was paid. */
export const paymentCaptureMethodEnum = pgEnum(
  "payment_capture_method",
  PAYMENT_CAPTURE_METHODS
);

/** #106: what a batch pays for. Every value is in its first migration. */
export const paymentPurposeEnum = pgEnum("payment_purpose", PAYMENT_PURPOSES);

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const paymentBatch = pgTable(
  "payment_batch",
  {
    /** UUIDv7; also the gateway order's receipt. */
    id: uuid().primaryKey(),
    /** Registration fees (#77) or a donation (#106). A donation's batch
     * has no route, competition or items: the donation is its subject. */
    purpose: paymentPurposeEnum().notNull().default("registration_fee"),
    /** Null on a donation's batch. */
    route: participationRouteEnum(),
    /** Null on a donation's batch. */
    competitionId: uuid("competition_id").references(() => competition.id, {
      onDelete: "restrict",
    }),
    /** The paying institution; null on the individual route (#78). */
    institutionId: uuid("institution_id").references(() => institution.id, {
      onDelete: "restrict",
    }),
    /** What the institution paid for; null on the individual route. */
    institutionRegistrationId: uuid("institution_registration_id").references(
      () => institutionRegistration.id,
      { onDelete: "restrict" }
    ),
    /** Who started the payment; null once their account is gone. */
    payerUserId: uuid("payer_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: paymentBatchStatusEnum().notNull(),
    /** Paise: the sum of the items. A bigint end to end. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull().default("INR"),
    /** The adapter that made the order, so a signal is read by the same. */
    gateway: text({ enum: GATEWAY_NAMES }).notNull(),
    /** Null until the gateway has made the order. */
    gatewayOrderId: text("gateway_order_id"),
    /** The captured payment; null until the batch is captured, and on a
     * batch paid offline. */
    gatewayPaymentId: text("gateway_payment_id"),
    /** How it was paid (#79); null until captured. Batches captured before
     * #79 were all paid through the gateway. */
    captureMethod: paymentCaptureMethodEnum("capture_method"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    capturedAt: timestamptz("captured_at"),
  },
  (table) => [
    unique("payment_batch_gateway_order_unique").on(
      table.gateway,
      table.gatewayOrderId
    ),
    // A free registration needs no batch: a batch always charges something.
    check("payment_batch_amount_positive", sql`${table.amountMinor} > 0`),
    // FOA takes domestic INR only (#55).
    check("payment_batch_currency_inr", sql`${table.currency} = 'INR'`),
    // A fee batch is for one competition's registrations; a donation's
    // batch is for no competition.
    check(
      "payment_batch_purpose_matches_subject",
      sql`(${table.purpose} = 'registration_fee') = (${table.competitionId} IS NOT NULL AND ${table.route} IS NOT NULL)`
    ),
    check(
      "payment_batch_institution_matches_route",
      sql`(${table.route} = 'institution') = (${table.institutionId} IS NOT NULL AND ${table.institutionRegistrationId} IS NOT NULL)`
    ),
    // A batch paid offline may never have had an order (#79).
    check(
      "payment_batch_order_when_opened",
      sql`${table.gatewayOrderId} IS NOT NULL OR ${table.status} NOT IN ('order_created', 'captured') OR (${table.status} = 'captured' AND ${table.captureMethod} = 'offline')`
    ),
    check(
      "payment_batch_payment_when_captured",
      sql`${table.status} <> 'captured' OR (${table.capturedAt} IS NOT NULL AND (${table.gatewayPaymentId} IS NOT NULL OR ${table.captureMethod} = 'offline'))`
    ),
    index("payment_batch_institution_registration_id_idx").on(
      table.institutionRegistrationId
    ),
    index("payment_batch_competition_id_idx").on(table.competitionId),
    index("payment_batch_institution_id_idx").on(table.institutionId),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("payment_batch_payer_user_id_idx").on(table.payerUserId),
  ]
);

export type PaymentBatchRow = typeof paymentBatch.$inferSelect;

/** The index a second batch holding the same registration runs into. */
export const PAYMENT_BATCH_ITEM_HOLDING_UNIQUE =
  "payment_batch_item_holding_unique";

export const paymentBatchItem = pgTable(
  "payment_batch_item",
  {
    batchId: uuid("batch_id")
      .notNull()
      .references(() => paymentBatch.id, { onDelete: "restrict" }),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registration.id, { onDelete: "restrict" }),
    /** The fee charged for this registration, in paise. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** When the batch let the registration go; null while it holds it. */
    releasedAt: timestamptz("released_at"),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.registrationId] }),
    // One batch at a time holds a registration, so two payers can't both
    // open an order for it.
    uniqueIndex(PAYMENT_BATCH_ITEM_HOLDING_UNIQUE)
      .on(table.registrationId)
      .where(sql`${table.releasedAt} IS NULL`),
    index("payment_batch_item_registration_id_idx").on(table.registrationId),
    check("payment_batch_item_amount_positive", sql`${table.amountMinor} > 0`),
  ]
);

/** The constraint a replayed webhook runs into. */
export const GATEWAY_WEBHOOK_EVENT_UNIQUE = "gateway_webhook_event_unique";

export const gatewayWebhookEvent = pgTable(
  "gateway_webhook_event",
  {
    id: uuid().primaryKey(),
    gateway: text({ enum: GATEWAY_NAMES }).notNull(),
    /** The gateway's id for the event; a replay repeats it. */
    eventId: text("event_id").notNull(),
    type: text().notNull(),
    orderId: text("order_id"),
    /** A signed capture snapshot, no raw payload or payer contact. */
    capturePaymentFingerprint: text("capture_payment_fingerprint"),
    captureOccurredBy: timestamptz("capture_occurred_by"),
    /** What handling it did; null until handling finished. */
    outcome: text({ enum: WEBHOOK_OUTCOMES }),
    receivedAt: timestamptz("received_at").notNull(),
    processedAt: timestamptz("processed_at"),
  },
  (table) => [
    unique(GATEWAY_WEBHOOK_EVENT_UNIQUE).on(table.gateway, table.eventId),
    check(
      "gateway_webhook_event_outcome_when_processed",
      sql`(${table.outcome} IS NULL) = (${table.processedAt} IS NULL)`
    ),
    check(
      "gateway_webhook_capture_evidence_pair",
      sql`(${table.capturePaymentFingerprint} IS NULL) = (${table.captureOccurredBy} IS NULL)`
    ),
    index("gateway_webhook_event_order_id_idx").on(table.orderId),
  ]
);

/** #79: how money reached FOA outside the gateway. */
export const offlinePaymentMethodEnum = pgEnum(
  "offline_payment_method",
  OFFLINE_PAYMENT_METHODS
);

export const offlinePayment = pgTable(
  "offline_payment",
  {
    id: uuid().primaryKey(),
    /** The batch it paid; one offline payment per batch. */
    batchId: uuid("batch_id")
      .notNull()
      .references(() => paymentBatch.id, { onDelete: "restrict" }),
    method: offlinePaymentMethodEnum().notNull(),
    /** Cheque number, transfer reference (UTR) or FOA cash receipt,
     * normalised (./modules/payments/domain/offline-payment.ts). */
    reference: text().notNull(),
    /** Paise; always the batch's amount. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** The calendar date in India the money arrived. */
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    /** The private proof file (a cheque image shows an account number and
     * a signature). Kept as long as the payment record. */
    proofFileAssetId: uuid("proof_file_asset_id")
      .notNull()
      .references(() => fileAsset.id, { onDelete: "restrict" }),
    /** The finance user who recorded it; null once their account is gone. */
    recordedByUserId: uuid("recorded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    recordedAt: timestamptz("recorded_at").notNull(),
  },
  (table) => [
    unique("offline_payment_batch_unique").on(table.batchId),
    check("offline_payment_amount_positive", sql`${table.amountMinor} > 0`),
    index("offline_payment_proof_file_asset_id_idx").on(table.proofFileAssetId),
    index("offline_payment_recorded_by_user_id_idx").on(table.recordedByUserId),
  ]
);

export type OfflinePaymentRow = typeof offlinePayment.$inferSelect;

/** #79: why a captured payment went to review. */
export const paymentReviewReasonEnum = pgEnum(
  "payment_review_reason",
  PAYMENT_REVIEW_REASONS
);

/** #79: how staff resolved a review case. */
export const paymentReviewOutcomeEnum = pgEnum(
  "payment_review_outcome",
  PAYMENT_REVIEW_OUTCOMES
);

export const DASHBOARD_REFUND_REFERENCE_UNIQUE =
  "payment_review_case_dashboard_refund_reference_unique";

export const paymentReviewCase = pgTable(
  "payment_review_case",
  {
    id: uuid().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => paymentBatch.id, { onDelete: "restrict" }),
    reason: paymentReviewReasonEnum().notNull(),
    /** The captured payment under review. */
    gatewayPaymentId: text("gateway_payment_id"),
    /** What the gateway captured, in the currency's minor units. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull(),
    /** Where the batch stood before review, so resolving knows where it
     * goes back to. Never needs_review: a second case copies the first's. */
    batchStatusBefore: paymentBatchStatusEnum("batch_status_before").notNull(),
    openedAt: timestamptz("opened_at").notNull(),
    resolvedAt: timestamptz("resolved_at"),
    /** Who resolved it; null while open, or once their account is gone. */
    resolvedByUserId: uuid("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    outcome: paymentReviewOutcomeEnum(),
    /** Why staff chose the outcome: free text, required to resolve. */
    resolutionReason: text("resolution_reason"),
    /** The refunds ticket (#80) owes the payer this payment back. */
    refundDue: boolean("refund_due").notNull().default(false),
    /** The gateway's processed refund, verified before clearing refundDue. */
    dashboardRefundReference: text("dashboard_refund_reference").unique(
      DASHBOARD_REFUND_REFERENCE_UNIQUE
    ),
  },
  (table) => [
    // A payment is reviewed once, however often its signals arrive.
    unique("payment_review_case_payment_unique").on(
      table.batchId,
      table.gatewayPaymentId
    ),
    check(
      "payment_review_case_resolved_together",
      sql`(${table.resolvedAt} IS NULL) = (${table.outcome} IS NULL) AND (${table.outcome} IS NULL) = (${table.resolutionReason} IS NULL)`
    ),
    check(
      "payment_review_case_refund_due_matches_outcome",
      sql`NOT ${table.refundDue} OR (${table.outcome} IS NOT NULL AND (${table.outcome} = 'refund' OR (${table.outcome} = 'confirm' AND ${table.currency} <> 'INR' AND ${table.gatewayPaymentId} IS NOT NULL AND ${table.amountMinor} > 0)))`
    ),
    check(
      "payment_review_case_dashboard_refund_settled",
      sql`${table.dashboardRefundReference} IS NULL OR (NOT ${table.refundDue} AND ${table.resolvedAt} IS NOT NULL AND ${table.outcome} IN ('refund', 'confirm') AND ${table.currency} <> 'INR' AND ${table.gatewayPaymentId} IS NOT NULL AND ${table.amountMinor} > 0)`
    ),
    index("payment_review_case_batch_id_idx").on(table.batchId),
    index("payment_review_case_opened_at_idx").on(table.openedAt),
    index("payment_review_case_resolved_by_user_id_idx").on(
      table.resolvedByUserId
    ),
  ]
);

export type PaymentReviewCaseRow = typeof paymentReviewCase.$inferSelect;
