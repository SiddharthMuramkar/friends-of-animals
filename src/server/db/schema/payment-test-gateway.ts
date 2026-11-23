// The non-production fallback gateway's own record (#77): the orders it
// made and the payments a tester made on them through its test checkout
// (src/server/ports/payment-gateway-fallback.ts). It stands where
// Razorpay's servers stand, so the payments module reads it only through
// the gateway port, never by joining these tables. Refunds (#80) are
// processed the moment they are made, as Razorpay's test mode does. Previews run serverless,
// so this state lives in the database to survive between requests.
// Production never builds the fallback, so these stay empty there. No
// personal data: amounts, ids and times only.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** What a test payment ended as: the tester paid or declined. */
export const GATEWAY_TEST_PAYMENT_STATUSES = ["captured", "failed"] as const;

export const gatewayTestOrder = pgTable(
  "gateway_test_order",
  {
    /** The order id the fallback gave the payments module. */
    id: text().primaryKey(),
    /** Paise. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull().default("INR"),
    /** The payment batch's id, as Razorpay keeps an order's receipt. */
    receipt: text().notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    check("gateway_test_order_amount_positive", sql`${table.amountMinor} > 0`),
  ]
);

export const gatewayTestPayment = pgTable(
  "gateway_test_payment",
  {
    id: text().primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => gatewayTestOrder.id, { onDelete: "cascade" }),
    status: text({ enum: GATEWAY_TEST_PAYMENT_STATUSES }).notNull(),
    /** Paise: the order's amount. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull().default("INR"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [index("gateway_test_payment_order_id_idx").on(table.orderId)]
);

/** What a test refund ended as. The fallback processes each at once. */
export const GATEWAY_TEST_REFUND_STATUSES = [
  "pending",
  "processed",
  "failed",
] as const;

export const gatewayTestRefund = pgTable(
  "gateway_test_refund",
  {
    id: text().primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => gatewayTestPayment.id, { onDelete: "cascade" }),
    status: text({ enum: GATEWAY_TEST_REFUND_STATUSES }).notNull(),
    /** Paise. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull().default("INR"),
    /** What the payments module sent with it: ids only. */
    notes: jsonb().$type<Record<string, string>>().notNull(),
    /** A second request with the same key returns the same refund. */
    idempotencyKey: text("idempotency_key")
      .notNull()
      .unique("gateway_test_refund_idempotency_key"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    check("gateway_test_refund_amount_positive", sql`${table.amountMinor} > 0`),
    index("gateway_test_refund_payment_id_idx").on(table.paymentId),
  ]
);
