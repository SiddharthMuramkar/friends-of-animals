import { describe, expect, it } from "vitest";

import {
  actualMinor,
  budgetVsActual,
  isBudgetableKind,
  parseBudgetAmount,
  type BudgetAccount,
} from "./budget-vs-actual";

describe("isBudgetableKind", () => {
  it("allows budgets on income and expense accounts only", () => {
    expect(isBudgetableKind("income")).toBe(true);
    expect(isBudgetableKind("expense")).toBe(true);
    for (const kind of ["asset", "liability", "equity"]) {
      expect(isBudgetableKind(kind)).toBe(false);
    }
  });
});

describe("actualMinor", () => {
  it("is credits less debits for income", () => {
    expect(
      actualMinor("income", { debitMinor: 20_000n, creditMinor: 150_000n })
    ).toBe(130_000n);
  });

  it("is debits less credits for an expense", () => {
    expect(
      actualMinor("expense", { debitMinor: 90_000n, creditMinor: 10_000n })
    ).toBe(80_000n);
  });

  it("goes negative when refunds outweigh income", () => {
    expect(
      actualMinor("income", { debitMinor: 30_000n, creditMinor: 10_000n })
    ).toBe(-20_000n);
  });
});

describe("parseBudgetAmount (rupees as typed, to paise)", () => {
  it.each([
    ["50000", 5_000_000n],
    ["50,000", 5_000_000n],
    ["1,00,000.5", 10_000_050n],
    ["0", 0n],
    [" 1250.75 ", 125_075n],
  ])("reads %j as %s paise", (input, expected) => {
    expect(parseBudgetAmount(input)).toEqual({
      ok: true,
      amountMinor: expected,
    });
  });

  it.each(["", "-5", "1.234", "abc", "1e5", "₹500", "12.", ".5", "1,,0"])(
    "refuses %j",
    (input) => {
      expect(parseBudgetAmount(input)).toEqual({
        ok: false,
        reason: "invalid_amount",
      });
    }
  );

  it("refuses more than Rs 1,000 crore", () => {
    expect(parseBudgetAmount("10,00,00,00,000")).toEqual({
      ok: true,
      amountMinor: 1_000_000_000_000n,
    });
    expect(parseBudgetAmount("10,00,00,00,000.01")).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});

const DONATIONS: BudgetAccount = {
  id: "acc-4200",
  code: "4200",
  name: "Donations (individual)",
  kind: "income",
};
const PRIZES: BudgetAccount = {
  id: "acc-5100",
  code: "5100",
  name: "Prizes and awards",
  kind: "expense",
};
const PRINTING: BudgetAccount = {
  id: "acc-5200",
  code: "5200",
  name: "Certificates and printing",
  kind: "expense",
};

describe("budgetVsActual", () => {
  // Two categories with budgets over two months, hand-computed.
  const report = budgetVsActual({
    accounts: [PRIZES, DONATIONS, PRINTING],
    months: ["2026-10", "2026-11"],
    budgets: [
      {
        accountId: DONATIONS.id,
        periodMonth: "2026-10",
        amountMinor: 1_000_000n,
      },
      {
        accountId: DONATIONS.id,
        periodMonth: "2026-11",
        amountMinor: 1_000_000n,
      },
      { accountId: PRIZES.id, periodMonth: "2026-10", amountMinor: 400_000n },
      { accountId: PRIZES.id, periodMonth: "2026-11", amountMinor: 0n },
      // Outside the range: ignored.
      { accountId: PRIZES.id, periodMonth: "2026-12", amountMinor: 999n },
    ],
    activity: [
      // October donations Rs 12,000 less a Rs 500 refund.
      {
        accountId: DONATIONS.id,
        periodMonth: "2026-10",
        debitMinor: 50_000n,
        creditMinor: 1_200_000n,
      },
      {
        accountId: DONATIONS.id,
        periodMonth: "2026-11",
        debitMinor: 0n,
        creditMinor: 333_333n,
      },
      {
        accountId: PRIZES.id,
        periodMonth: "2026-10",
        debitMinor: 500_000n,
        creditMinor: 0n,
      },
      {
        accountId: PRIZES.id,
        periodMonth: "2026-11",
        debitMinor: 25_000n,
        creditMinor: 0n,
      },
      // An asset account isn't reported.
      {
        accountId: "acc-1100",
        periodMonth: "2026-10",
        debitMinor: 1_200_000n,
        creditMinor: 50_000n,
      },
    ],
  });

  it("lists income accounts, then expense accounts, each by code", () => {
    expect(report.rows.map((row) => row.account.code)).toEqual([
      "4200",
      "5100",
      "5200",
    ]);
  });

  it("compares income with its budget: ahead is favourable", () => {
    const donations = report.rows[0]!;
    expect(donations.months).toEqual([
      {
        periodMonth: "2026-10",
        budgetMinor: 1_000_000n,
        actualMinor: 1_150_000n,
        varianceMinor: 150_000n,
        usedPercent: 115,
        favourable: true,
      },
      {
        periodMonth: "2026-11",
        budgetMinor: 1_000_000n,
        actualMinor: 333_333n,
        varianceMinor: -666_667n,
        // 33.3333...% truncates to one decimal.
        usedPercent: 33.3,
        favourable: false,
      },
    ]);
    expect(donations.total).toEqual({
      budgetMinor: 2_000_000n,
      actualMinor: 1_483_333n,
      varianceMinor: -516_667n,
      usedPercent: 74.1,
      favourable: false,
    });
  });

  it("compares an expense with its budget: over is unfavourable", () => {
    const prizes = report.rows[1]!;
    expect(prizes.months[0]).toEqual({
      periodMonth: "2026-10",
      budgetMinor: 400_000n,
      actualMinor: 500_000n,
      varianceMinor: 100_000n,
      usedPercent: 125,
      favourable: false,
    });
    // A zero budget has no percentage, and any spend is over it.
    expect(prizes.months[1]).toEqual({
      periodMonth: "2026-11",
      budgetMinor: 0n,
      actualMinor: 25_000n,
      varianceMinor: 25_000n,
      usedPercent: null,
      favourable: false,
    });
  });

  it("shows an account with neither budget nor activity as zero, with no budget", () => {
    const printing = report.rows[2]!;
    expect(printing.months.map((cell) => cell.budgetMinor)).toEqual([
      null,
      null,
    ]);
    expect(printing.months.map((cell) => cell.actualMinor)).toEqual([0n, 0n]);
    expect(printing.total).toEqual({
      budgetMinor: null,
      actualMinor: 0n,
      varianceMinor: null,
      usedPercent: null,
      favourable: null,
    });
  });

  it("totals income, expense and net per month and for the range", () => {
    expect(report.totals.income.total).toEqual({
      budgetMinor: 2_000_000n,
      actualMinor: 1_483_333n,
    });
    expect(report.totals.expense.months).toEqual([
      { periodMonth: "2026-10", budgetMinor: 400_000n, actualMinor: 500_000n },
      { periodMonth: "2026-11", budgetMinor: 0n, actualMinor: 25_000n },
    ]);
    expect(report.totals.net.total).toEqual({
      budgetMinor: 1_600_000n,
      actualMinor: 958_333n,
    });
  });

  it("refuses a non-budgetable account", () => {
    expect(() =>
      budgetVsActual({
        accounts: [{ id: "a", code: "1000", name: "Bank", kind: "asset" }],
        months: ["2026-10"],
        budgets: [],
        activity: [],
      })
    ).toThrow(RangeError);
  });
});
