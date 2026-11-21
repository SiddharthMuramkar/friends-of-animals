// Payments (#77). A payment batch is one gateway order for one or more
// registrations: a coordinator's batch of N, later an adult's batch of one
// (#78).
//
// - payment_batch: the order, its total in paise and its status
//   (src/server/payments/domain/batch-status.ts). Never deleted: payment
//   records outlive accounts (HR-31), so the payer goes to null instead.
// - payment_batch_item: one row per registration, with the fee it was
//   charged. While `released_at` is null the batch holds the registration,
//   and a partial unique index lets only one batch hold it at a time. The
//   index predicate names no status, so later statuses (#79, #80) need no
//   change to it.
// - gateway_webhook_event: one row per webhook whose signature checked out,
//   to drop replays and keep what each led to. Never the raw payload: it
//   carries the payer's email and phone.
//
// The registration and institution columns get their foreign keys once
// 75a's institution_registration, 75b's registration and #73's institution
// tables are on this branch.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
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

import { PAYMENT_BATCH_STATUSES } from "../../payments/domain/batch-status";
import { WEBHOOK_OUTCOMES } from "../../payments/domain/outcomes";
import { GATEWAY_NAMES } from "../../ports/payment-gateway";
import { competition } from "./competitions";
import { participationRouteEnum } from "./competition-terms";
import { user } from "./identity";

/** #79 and #80 add their statuses, each in its own migration. */
export const paymentBatchStatusEnum = pgEnum(
  "payment_batch_status",
  PAYMENT_BATCH_STATUSES
);

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const paymentBatch = pgTable(
  "payment_batch",
  {
    /** UUIDv7; also the gateway order's receipt. */
    id: uuid().primaryKey(),
    route: participationRouteEnum().notNull(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "restrict" }),
    /** The paying institution; null on the individual route (#78). */
    institutionId: uuid("institution_id"),
    /** What the institution paid for; null on the individual route. */
    institutionRegistrationId: uuid("institution_registration_id"),
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
    /** The captured payment; null until the batch is captured. */
    gatewayPaymentId: text("gateway_payment_id"),
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
    check(
      "payment_batch_institution_matches_route",
      sql`(${table.route} = 'institution') = (${table.institutionId} IS NOT NULL AND ${table.institutionRegistrationId} IS NOT NULL)`
    ),
    check(
      "payment_batch_order_when_opened",
      sql`${table.status} NOT IN ('order_created', 'captured') OR ${table.gatewayOrderId} IS NOT NULL`
    ),
    check(
      "payment_batch_payment_when_captured",
      sql`${table.status} <> 'captured' OR (${table.capturedAt} IS NOT NULL AND ${table.gatewayPaymentId} IS NOT NULL)`
    ),
    index("payment_batch_institution_registration_id_idx").on(
      table.institutionRegistrationId
    ),
    index("payment_batch_competition_id_idx").on(table.competitionId),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("payment_batch_payer_user_id_idx").on(table.payerUserId),
  ]
);

export type PaymentBatchRow = typeof paymentBatch.$inferSelect;

export const paymentBatchItem = pgTable(
  "payment_batch_item",
  {
    batchId: uuid("batch_id")
      .notNull()
      .references(() => paymentBatch.id, { onDelete: "restrict" }),
    registrationId: uuid("registration_id").notNull(),
    /** The fee charged for this registration, in paise. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** When the batch let the registration go; null while it holds it. */
    releasedAt: timestamptz("released_at"),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.registrationId] }),
    // One batch at a time holds a registration, so two payers can't both
    // open an order for it.
    uniqueIndex("payment_batch_item_holding_unique")
      .on(table.registrationId)
      .where(sql`${table.releasedAt} IS NULL`),
    index("payment_batch_item_registration_id_idx").on(table.registrationId),
    check("payment_batch_item_amount_positive", sql`${table.amountMinor} > 0`),
  ]
);

export const gatewayWebhookEvent = pgTable(
  "gateway_webhook_event",
  {
    id: uuid().primaryKey(),
    gateway: text({ enum: GATEWAY_NAMES }).notNull(),
    /** The gateway's id for the event; a replay repeats it. */
    eventId: text("event_id").notNull(),
    type: text().notNull(),
    orderId: text("order_id"),
    /** What handling it did; null until handling finished. */
    outcome: text({ enum: WEBHOOK_OUTCOMES }),
    receivedAt: timestamptz("received_at").notNull(),
    processedAt: timestamptz("processed_at"),
  },
  (table) => [
    unique("gateway_webhook_event_unique").on(table.gateway, table.eventId),
    check(
      "gateway_webhook_event_outcome_when_processed",
      sql`(${table.outcome} IS NULL) = (${table.processedAt} IS NULL)`
    ),
    index("gateway_webhook_event_order_id_idx").on(table.orderId),
  ]
);
