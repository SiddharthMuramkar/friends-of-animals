// Budgets (#109): what finance plans to receive or spend per category (an
// income or expense account of the ledger) per IST month. The budget
// report puts the ledger's actuals beside them
// (src/server/modules/ledger/budgets.ts). Planning data, not postings, so
// a locked month may still get a budget.
//
// People are referenced without foreign keys, as in the ledger.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { ledgerAccount } from "./ledger";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** One category's budget for one month. */
export const ledgerBudget = pgTable(
  "ledger_budget",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => ledgerAccount.id),
    /** `YYYY-MM`, the month in India. */
    periodMonth: text("period_month").notNull(),
    /** Paise, from zero up to Rs 1,000 crore. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    createdByUserId: uuid("created_by_user_id"),
    updatedByUserId: uuid("updated_by_user_id"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    unique("ledger_budget_account_month_key").on(
      table.accountId,
      table.periodMonth
    ),
    check(
      "ledger_budget_period_month_format",
      sql`${table.periodMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`
    ),
    check(
      "ledger_budget_amount_range",
      sql`${table.amountMinor} BETWEEN 0 AND 1000000000000`
    ),
    // The report reads a range of months.
    index("ledger_budget_period_month_idx").on(table.periodMonth),
  ]
);

export type LedgerBudgetRow = typeof ledgerBudget.$inferSelect;
