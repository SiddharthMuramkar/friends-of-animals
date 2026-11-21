import { describe, expect, it } from "vitest";

import { trialBalance } from "./trial-balance";

describe("trialBalance()", () => {
  it("totals each account's debits and credits, sorted by code", () => {
    expect(
      trialBalance([
        { accountCode: "4100", debitMinor: 0n, creditMinor: 500n },
        { accountCode: "1100", debitMinor: 500n, creditMinor: 0n },
        { accountCode: "4100", debitMinor: 200n, creditMinor: 0n },
        { accountCode: "1100", debitMinor: 0n, creditMinor: 200n },
      ])
    ).toEqual({
      accounts: [
        { accountCode: "1100", debitMinor: 500n, creditMinor: 200n },
        { accountCode: "4100", debitMinor: 200n, creditMinor: 500n },
      ],
      debitMinor: 700n,
      creditMinor: 700n,
      balanced: true,
    });
  });

  it("says when the books don't balance", () => {
    const result = trialBalance([
      { accountCode: "1000", debitMinor: 10n, creditMinor: 0n },
      { accountCode: "4900", debitMinor: 0n, creditMinor: 9n },
    ]);
    expect(result.balanced).toBe(false);
  });

  it("balances an empty ledger", () => {
    expect(trialBalance([])).toEqual({
      accounts: [],
      debitMinor: 0n,
      creditMinor: 0n,
      balanced: true,
    });
  });
});
