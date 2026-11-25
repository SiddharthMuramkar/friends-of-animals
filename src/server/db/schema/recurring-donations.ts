import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { RECURRING_DONATION_STATUSES } from "../../modules/donations/recurring/domain/recurring-status";
import { GATEWAY_NAMES } from "../../ports/payment-gateway";
import { donor } from "./donations";
import { user } from "./identity";
import { refund } from "./refunds";

const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const recurringStatusEnum = pgEnum(
  "recurring_donation_status",
  RECURRING_DONATION_STATUSES
);
export const gatewayPlan = pgTable(
  "gateway_plan",
  {
    gateway: text({ enum: GATEWAY_NAMES }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    gatewayPlanId: text("gateway_plan_id").primaryKey(),
  },
  (t) => [
    unique("gateway_plan_amount_unique").on(t.gateway, t.amountMinor),
    check("gateway_plan_positive", sql`${t.amountMinor} > 0`),
  ]
);
export const recurringDonation = pgTable(
  "recurring_donation",
  {
    id: uuid().primaryKey(),
    donorId: uuid("donor_id")
      .notNull()
      .references(() => donor.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    status: recurringStatusEnum().notNull(),
    gateway: text({ enum: GATEWAY_NAMES }).notNull(),
    gatewayPlanId: text("gateway_plan_id")
      .notNull()
      .references(() => gatewayPlan.gatewayPlanId),
    gatewaySubscriptionId: text("gateway_subscription_id").notNull().unique(),
    showOnWall: boolean("show_on_wall").notNull(),
    wallName: text("wall_name"),
    nextChargeAt: time("next_charge_at"),
    cancelRequestedAt: time("cancel_requested_at"),
    cancelRequestedBy: text("cancel_requested_by", {
      enum: ["donor", "finance", "system"],
    }),
    cancelledAt: time("cancelled_at"),
    cancelledBy: text("cancelled_by", {
      enum: ["donor", "finance", "system", "provider"],
    }),
    createdAt: time("created_at").notNull(),
    updatedAt: time("updated_at").notNull(),
  },
  (t) => [
    index("recurring_donation_user_idx").on(t.userId),
    check("recurring_donation_positive", sql`${t.amountMinor} > 0`),
  ]
);
export type RecurringDonationRow = typeof recurringDonation.$inferSelect;
export const recurringChargeFailure = pgTable(
  "recurring_charge_failure",
  {
    recurringDonationId: uuid("recurring_donation_id")
      .notNull()
      .references(() => recurringDonation.id),
    cycleKey: text("cycle_key").notNull(),
    notifiedAt: time("notified_at").notNull(),
  },
  (t) => [
    unique("recurring_charge_failure_cycle").on(
      t.recurringDonationId,
      t.cycleKey
    ),
  ]
);
export const recurringRefusedCharge = pgTable("recurring_refused_charge", {
  gatewayPaymentId: text("gateway_payment_id").primaryKey(),
  recurringDonationId: uuid("recurring_donation_id")
    .notNull()
    .references(() => recurringDonation.id),
  refundId: uuid("refund_id")
    .notNull()
    .references(() => refund.id),
});
export const gatewayTestSubscription = pgTable("gateway_test_subscription", {
  id: text().primaryKey(),
  planId: text("plan_id").notNull(),
  status: text().notNull(),
  currentStart: time("current_start"),
  chargeAt: time("charge_at"),
  endedAt: time("ended_at"),
  notes: jsonb().$type<Record<string, string>>().notNull(),
});
export const gatewayTestPlan = pgTable("gateway_test_plan", {
  id: text().primaryKey(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
});
