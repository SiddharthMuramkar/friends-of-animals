// A trial balance: every account's debit and credit totals, and whether the
// books balance. Tests use it to prove a set of postings is balanced; #109's
// budget report and export build on it. Pure; no imports.

export type LineTotals = {
  accountCode: string;
  debitMinor: bigint;
  creditMinor: bigint;
};

export type TrialBalance = {
  /** One row per account that has lines, sorted by code. */
  accounts: LineTotals[];
  debitMinor: bigint;
  creditMinor: bigint;
  balanced: boolean;
};

export function trialBalance(lines: readonly LineTotals[]): TrialBalance {
  const byAccount = new Map<string, LineTotals>();
  let debitMinor = 0n;
  let creditMinor = 0n;
  for (const line of lines) {
    const totals = byAccount.get(line.accountCode) ?? {
      accountCode: line.accountCode,
      debitMinor: 0n,
      creditMinor: 0n,
    };
    totals.debitMinor += line.debitMinor;
    totals.creditMinor += line.creditMinor;
    byAccount.set(line.accountCode, totals);
    debitMinor += line.debitMinor;
    creditMinor += line.creditMinor;
  }
  const accounts = [...byAccount.values()].sort((a, b) =>
    a.accountCode.localeCompare(b.accountCode)
  );
  return {
    accounts,
    debitMinor,
    creditMinor,
    balanced: debitMinor === creditMinor,
  };
}
