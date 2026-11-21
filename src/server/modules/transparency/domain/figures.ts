// The money half of the transparency page (#110): income and spending by
// public category for each published month of one financial year, and the
// year to date. "Published" means locked: the ledger refuses postings into a
// locked month, so these figures can't change under a reader. Unlocked
// months are dropped here even if the caller passes their totals.
//
// Every income and expense account counts in exactly one category, so the
// page's totals equal the ledger's (an account without a public label shows
// as "other"; nothing is left out). Balance-sheet accounts never show, which
// keeps money held for refund, such as a refused foreign payment, out of
// income. The output names categories, never accounts or postings.
// Pure; no imports beyond the period helpers.

import {
  monthsOfFinancialYear,
  type FinancialYear,
  type PeriodMonth,
} from "./financial-year";

export type AccountKind =
  | "asset"
  | "liability"
  | "income"
  | "expense"
  | "equity";

/** A ledger account as the page may see it. */
export type PublicAccount = {
  code: string;
  kind: AccountKind;
  /** Finance's public name for it; accounts may share one. */
  publicLabel: string | null;
  /** A broad group such as `programs` or `administration`. */
  publicGroup: string | null;
};

/** One account's debits and credits in one period month. */
export type AccountTotal = {
  month: PeriodMonth;
  accountCode: string;
  debitMinor: bigint;
  creditMinor: bigint;
};

/** A public category's net amount, in paise. `label: null` is "other". */
export type CategoryTotal = {
  label: string | null;
  group: string | null;
  amountMinor: bigint;
};

export type Totals = {
  income: CategoryTotal[];
  spending: CategoryTotal[];
  incomeMinor: bigint;
  spendingMinor: bigint;
  /** Donation income net of refunds: the funds-raised figure. */
  donationsMinor: bigint;
};

export type MonthFigures = Totals & { month: PeriodMonth };

export type Figures = {
  /** The financial year, e.g. "2026-27". */
  fy: string;
  /** Its locked months, oldest first. */
  months: MonthFigures[];
  yearToDate: Totals;
  /** The latest locked month shown, or null when none is. */
  publishedThrough: PeriodMonth | null;
};

type Side = "income" | "spending";

/** Net amounts per category, keyed by label within one side. */
class Tally {
  readonly #categories = new Map<string, CategoryTotal>();

  add(label: string | null, group: string | null, amountMinor: bigint) {
    const key = label ?? "";
    const current = this.#categories.get(key);
    if (current) current.amountMinor += amountMinor;
    else this.#categories.set(key, { label, group, amountMinor });
  }

  get total(): bigint {
    let sum = 0n;
    for (const { amountMinor } of this.#categories.values()) sum += amountMinor;
    return sum;
  }

  /** Non-zero categories, largest first; "other" last. */
  list(): CategoryTotal[] {
    return [...this.#categories.values()]
      .filter((c) => c.amountMinor !== 0n)
      .sort((a, b) => {
        if ((a.label === null) !== (b.label === null)) {
          return a.label === null ? 1 : -1;
        }
        if (a.amountMinor !== b.amountMinor) {
          return a.amountMinor > b.amountMinor ? -1 : 1;
        }
        return (a.label ?? "").localeCompare(b.label ?? "");
      });
  }
}

class Period {
  readonly income = new Tally();
  readonly spending = new Tally();
  donationsMinor = 0n;

  totals(): Totals {
    return {
      income: this.income.list(),
      spending: this.spending.list(),
      incomeMinor: this.income.total,
      spendingMinor: this.spending.total,
      donationsMinor: this.donationsMinor,
    };
  }
}

export function buildFigures(input: {
  fy: FinancialYear;
  lockedMonths: Iterable<PeriodMonth>;
  accounts: readonly PublicAccount[];
  totals: readonly AccountTotal[];
  donationAccountCodes: ReadonlySet<string>;
}): Figures {
  const locked = new Set(input.lockedMonths);
  const shown = monthsOfFinancialYear(input.fy).filter((m) => locked.has(m));
  const periods = new Map(shown.map((m) => [m, new Period()]));
  const year = new Period();
  const accounts = new Map(input.accounts.map((a) => [a.code, a]));

  for (const row of input.totals) {
    const account = accounts.get(row.accountCode);
    if (!account) {
      throw new Error(`No account ${row.accountCode} for a ledger total`);
    }
    const period = periods.get(row.month);
    if (!period) continue;
    const side: Side | null =
      account.kind === "income"
        ? "income"
        : account.kind === "expense"
          ? "spending"
          : null;
    if (side === null) continue;
    const net =
      side === "income"
        ? row.creditMinor - row.debitMinor
        : row.debitMinor - row.creditMinor;
    for (const target of [period, year]) {
      target[side].add(account.publicLabel, account.publicGroup, net);
      if (input.donationAccountCodes.has(account.code)) {
        target.donationsMinor += net;
      }
    }
  }

  return {
    fy: input.fy.label,
    months: shown.map((month) => ({ month, ...periods.get(month)!.totals() })),
    yearToDate: year.totals(),
    publishedThrough: shown.at(-1) ?? null,
  };
}

/**
 * The funds-raised counter on the impact page. It is read from the same
 * figures as the transparency page, so the two can't disagree.
 */
export function fundsRaised(figures: Figures): {
  fy: string;
  amountMinor: bigint;
  publishedThrough: PeriodMonth | null;
} {
  return {
    fy: figures.fy,
    amountMinor: figures.yearToDate.donationsMinor,
    publishedThrough: figures.publishedThrough,
  };
}
