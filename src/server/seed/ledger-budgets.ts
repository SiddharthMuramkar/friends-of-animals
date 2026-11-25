// Budget seed data (#109): a budget for every month of the current
// financial year on a few income and expense categories, so a preview's
// budget report shows variances against the seeded postings. Loads under
// plain Node (the seed script): relative imports only, no "server-only".

import { inArray } from "drizzle-orm";

import { ledgerAccount, ledgerBudget } from "../db/schema";
import { uuidv7 } from "../ids";
import {
  financialYearMonths,
  periodMonthOf,
} from "../modules/ledger/domain/period";
import type { Seeder } from "./types";

/** Rupees a month, by category code. */
const MONTHLY_BUDGETS = {
  "4100": 60_000,
  "4900": 10_000,
  "5300": 8_000,
  "5400": 5_000,
  "5600": 25_000,
} as const;

/** Stores each seeded budget unless that category and month has one. */
export const seedBudgets: Seeder = async ({ db, clock }) => {
  const now = clock.now();
  const accounts = await db
    .select({ id: ledgerAccount.id, code: ledgerAccount.code })
    .from(ledgerAccount)
    .where(inArray(ledgerAccount.code, Object.keys(MONTHLY_BUDGETS)));
  const months = financialYearMonths(periodMonthOf(now));
  const rows = accounts.flatMap(({ id, code }) =>
    months.map((periodMonth) => ({
      id: uuidv7(now),
      accountId: id,
      periodMonth,
      amountMinor:
        BigInt(MONTHLY_BUDGETS[code as keyof typeof MONTHLY_BUDGETS]) * 100n,
      createdAt: now,
      updatedAt: now,
    }))
  );
  if (rows.length === 0) return;
  await db
    .insert(ledgerBudget)
    .values(rows)
    .onConflictDoNothing({
      target: [ledgerBudget.accountId, ledgerBudget.periodMonth],
    });
};
