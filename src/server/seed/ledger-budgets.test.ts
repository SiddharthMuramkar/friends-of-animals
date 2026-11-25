import { describe, expect, it } from "vitest";

import { ledgerBudget } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_LEDGER_FINANCE } from "./ledger-periods";

describe("the budget seed (#109)", () => {
  it("budgets every month of the current financial year on five categories, once", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const first = await h.db
      .select({ id: ledgerBudget.id })
      .from(ledgerBudget)
      .orderBy(ledgerBudget.id);
    h.clock.advance({ days: 1 });
    await h.seed.preview();
    expect(
      await h.db
        .select({ id: ledgerBudget.id })
        .from(ledgerBudget)
        .orderBy(ledgerBudget.id)
    ).toEqual(first);
    expect(first).toHaveLength(5 * 12);
  });

  it("gives the budget report variances to show", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const finance = await h.seed.member({ email: SEED_LEDGER_FINANCE.email });
    const actor = await h.signIn(finance);
    const report = await h.as(actor).budgetVsActual();
    if (!report.ok) throw new Error(JSON.stringify(report));
    expect(report.months[0]).toBe("2026-04");
    const fees = report.rows.find(({ account }) => account.code === "4100");
    expect(fees?.total.budgetMinor).toBe(60_000n * 100n * 12n);
    expect(report.totals.expense.total.budgetMinor).toBe(
      (8_000n + 5_000n + 25_000n) * 100n * 12n
    );
  });
});
