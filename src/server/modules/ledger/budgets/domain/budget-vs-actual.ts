// Budgets and budget versus actual (#109). Finance sets a budget per
// category (an income or expense account) per month; the report puts each
// month's actual next to it. Pure: the caller loads the accounts, the
// months of the range (`YYYY-MM`, in order), the budgets and the summed
// ledger activity per account and month, all in paise.
//
// Actual follows the account's normal side: income is credits less debits
// (refunds reduce it), an expense is debits less credits.

export type BudgetableKind = "income" | "expense";

export function isBudgetableKind(kind: string): kind is BudgetableKind {
  return kind === "income" || kind === "expense";
}

/** An account's actual for some activity, on its normal side. */
export function actualMinor(
  kind: BudgetableKind,
  activity: { debitMinor: bigint; creditMinor: bigint }
): bigint {
  return kind === "income"
    ? activity.creditMinor - activity.debitMinor
    : activity.debitMinor - activity.creditMinor;
}

/** Rs 1,000 crore in paise: the largest budget for one category and month. */
export const MAX_BUDGET_MINOR = 1_000_000_000_000n;

const RUPEES = /^(\d+(?:,\d+)*)(?:\.(\d{1,2}))?$/;

export type BudgetAmount =
  | { ok: true; amountMinor: bigint }
  | { ok: false; reason: "invalid_amount" | "too_large" };

/**
 * A budget as finance types it, in rupees ("50,000", "1,00,000.50"), as
 * paise. Commas group digits in either the Indian or the Western way; no
 * sign, no symbol, at most two decimals.
 */
export function parseBudgetAmount(input: string): BudgetAmount {
  const match = RUPEES.exec(input.trim());
  if (!match) return { ok: false, reason: "invalid_amount" };
  const rupees = BigInt(match[1]!.replaceAll(",", ""));
  const paise = BigInt((match[2] ?? "").padEnd(2, "0"));
  const amountMinor = rupees * 100n + paise;
  return amountMinor > MAX_BUDGET_MINOR
    ? { ok: false, reason: "too_large" }
    : { ok: true, amountMinor };
}

export type BudgetAccount = {
  id: string;
  code: string;
  name: string;
  kind: string;
};

export type BudgetRow = {
  accountId: string;
  periodMonth: string;
  amountMinor: bigint;
};

export type AccountActivity = {
  accountId: string;
  periodMonth: string;
  debitMinor: bigint;
  creditMinor: bigint;
};

export type Comparison = {
  /** Null when no budget is set. */
  budgetMinor: bigint | null;
  actualMinor: bigint;
  /** Actual less budget; null without a budget. */
  varianceMinor: bigint | null;
  /** Actual as a percentage of budget, truncated to one decimal; null without a positive budget. */
  usedPercent: number | null;
  /** Income at or above budget, or an expense at or below it; null without a budget. */
  favourable: boolean | null;
};

export type MonthComparison = Comparison & { periodMonth: string };

export type AccountReport = {
  account: BudgetAccount & { kind: BudgetableKind };
  months: MonthComparison[];
  /** Over the range: the budgets that are set, and every actual. */
  total: Comparison;
};

type Sums = { budgetMinor: bigint; actualMinor: bigint };

export type KindTotals = {
  /** Missing budgets count as zero here. */
  months: (Sums & { periodMonth: string })[];
  total: Sums;
};

export type BudgetReport = {
  /** Income accounts, then expense accounts, each by code. */
  rows: AccountReport[];
  totals: { income: KindTotals; expense: KindTotals; net: KindTotals };
};

function compare(
  kind: BudgetableKind,
  budgetMinor: bigint | null,
  actual: bigint
): Comparison {
  if (budgetMinor === null) {
    return {
      budgetMinor,
      actualMinor: actual,
      varianceMinor: null,
      usedPercent: null,
      favourable: null,
    };
  }
  return {
    budgetMinor,
    actualMinor: actual,
    varianceMinor: actual - budgetMinor,
    // Tenths of a percent in bigint, so no float touches the money.
    usedPercent:
      budgetMinor > 0n ? Number((actual * 1000n) / budgetMinor) / 10 : null,
    favourable:
      kind === "income" ? actual >= budgetMinor : actual <= budgetMinor,
  };
}

const key = (accountId: string, month: string) => `${accountId}|${month}`;

function emptyTotals(months: readonly string[]): KindTotals {
  return {
    months: months.map((periodMonth) => ({
      periodMonth,
      budgetMinor: 0n,
      actualMinor: 0n,
    })),
    total: { budgetMinor: 0n, actualMinor: 0n },
  };
}

/** Budget versus actual for `accounts` over `months`. Other rows are ignored. */
export function budgetVsActual(input: {
  accounts: readonly BudgetAccount[];
  months: readonly string[];
  budgets: readonly BudgetRow[];
  activity: readonly AccountActivity[];
}): BudgetReport {
  const budgets = new Map<string, bigint>();
  for (const row of input.budgets) {
    budgets.set(key(row.accountId, row.periodMonth), row.amountMinor);
  }
  const activity = new Map<
    string,
    { debitMinor: bigint; creditMinor: bigint }
  >();
  for (const row of input.activity) {
    const k = key(row.accountId, row.periodMonth);
    const sum = activity.get(k) ?? { debitMinor: 0n, creditMinor: 0n };
    activity.set(k, {
      debitMinor: sum.debitMinor + row.debitMinor,
      creditMinor: sum.creditMinor + row.creditMinor,
    });
  }

  const totals = {
    income: emptyTotals(input.months),
    expense: emptyTotals(input.months),
  };

  const rows = input.accounts
    .map((account): AccountReport => {
      const { kind } = account;
      if (!isBudgetableKind(kind)) {
        throw new RangeError(
          `Account ${account.code} is ${kind}; only income and expense accounts have budgets`
        );
      }
      let budgetTotal: bigint | null = null;
      let actualTotal = 0n;
      const months: MonthComparison[] = [];
      for (const [index, periodMonth] of input.months.entries()) {
        const k = key(account.id, periodMonth);
        const budget = budgets.get(k) ?? null;
        const actual = actualMinor(
          kind,
          activity.get(k) ?? { debitMinor: 0n, creditMinor: 0n }
        );
        if (budget !== null) budgetTotal = (budgetTotal ?? 0n) + budget;
        actualTotal += actual;
        const kindMonth = totals[kind].months[index]!;
        kindMonth.budgetMinor += budget ?? 0n;
        kindMonth.actualMinor += actual;
        months.push({ periodMonth, ...compare(kind, budget, actual) });
      }
      totals[kind].total.budgetMinor += budgetTotal ?? 0n;
      totals[kind].total.actualMinor += actualTotal;
      return {
        account: { ...account, kind },
        months,
        total: compare(kind, budgetTotal, actualTotal),
      };
    })
    .sort(
      (a, b) =>
        (a.account.kind === b.account.kind
          ? 0
          : a.account.kind === "income"
            ? -1
            : 1) || a.account.code.localeCompare(b.account.code)
    );

  const net: KindTotals = {
    months: totals.income.months.map((income, index) => {
      const expense = totals.expense.months[index]!;
      return {
        periodMonth: income.periodMonth,
        budgetMinor: income.budgetMinor - expense.budgetMinor,
        actualMinor: income.actualMinor - expense.actualMinor,
      };
    }),
    total: {
      budgetMinor:
        totals.income.total.budgetMinor - totals.expense.total.budgetMinor,
      actualMinor:
        totals.income.total.actualMinor - totals.expense.total.actualMinor,
    },
  };

  return { rows, totals: { ...totals, net } };
}
