import { describe, expect, it } from "vitest";

import {
  checkLines,
  fromColumns,
  type LineDraft,
  MAX_LINES,
  reverseLines,
  toColumns,
} from "./posting";

const debit = (accountCode: string, amountMinor: bigint): LineDraft => ({
  accountCode,
  side: "debit",
  amountMinor,
});
const credit = (accountCode: string, amountMinor: bigint): LineDraft => ({
  accountCode,
  side: "credit",
  amountMinor,
});

describe("checkLines()", () => {
  it("accepts balanced lines and reports the total of either side", () => {
    expect(checkLines([debit("1100", 50000n), credit("4100", 50000n)])).toEqual(
      { ok: true, totalMinor: 50000n }
    );
  });

  it("accepts a split posting: one debit against two credits", () => {
    expect(
      checkLines([
        debit("1000", 30000n),
        credit("4100", 20000n),
        credit("4900", 10000n),
      ])
    ).toEqual({ ok: true, totalMinor: 30000n });
  });

  it("refuses fewer than two lines", () => {
    expect(checkLines([])).toEqual({ ok: false, error: "too_few_lines" });
    expect(checkLines([debit("1000", 1n)])).toEqual({
      ok: false,
      error: "too_few_lines",
    });
  });

  it("refuses more lines than a posting may hold", () => {
    const lines = Array.from({ length: MAX_LINES + 1 }, (_, index) =>
      index === 0 ? debit("1000", BigInt(MAX_LINES)) : credit("4900", 1n)
    );
    expect(checkLines(lines)).toEqual({ ok: false, error: "too_many_lines" });
  });

  it("refuses a zero or negative amount and says which line", () => {
    expect(checkLines([debit("1000", 100n), credit("4100", 0n)])).toEqual({
      ok: false,
      error: "non_positive_amount",
      lineIndex: 1,
    });
    expect(checkLines([debit("1000", -100n), credit("4100", -100n)])).toEqual({
      ok: false,
      error: "non_positive_amount",
      lineIndex: 0,
    });
  });

  it("refuses unbalanced lines and reports both sides", () => {
    expect(checkLines([debit("5300", 10000n), credit("1000", 9000n)])).toEqual({
      ok: false,
      error: "unbalanced",
      debitMinor: 10000n,
      creditMinor: 9000n,
    });
  });

  it("refuses lines all on one side", () => {
    expect(checkLines([debit("1000", 1n), debit("1010", 1n)])).toEqual({
      ok: false,
      error: "unbalanced",
      debitMinor: 2n,
      creditMinor: 0n,
    });
  });

  it("refuses an empty account code", () => {
    expect(checkLines([debit("", 1n), credit("4100", 1n)])).toEqual({
      ok: false,
      error: "missing_account",
      lineIndex: 0,
    });
  });
});

describe("reverseLines()", () => {
  it("mirrors every line onto the other side, keeping accounts, amounts and memos", () => {
    const original: LineDraft[] = [
      { ...debit("5300", 10000n), memo: "Van hire" },
      credit("1000", 10000n),
    ];
    expect(reverseLines(original)).toEqual([
      { ...credit("5300", 10000n), memo: "Van hire" },
      debit("1000", 10000n),
    ]);
  });

  it("keeps a reversal balanced and undoes the original", () => {
    const original = [
      debit("1000", 30000n),
      credit("4100", 20000n),
      credit("4900", 10000n),
    ];
    const reversed = reverseLines(original);
    expect(checkLines(reversed)).toEqual({ ok: true, totalMinor: 30000n });
    expect(reverseLines(reversed)).toEqual(original);
  });

  it("leaves the original untouched", () => {
    const original = [debit("1000", 1n), credit("4100", 1n)];
    reverseLines(original);
    expect(original[0]!.side).toBe("debit");
  });
});

describe("toColumns() and fromColumns()", () => {
  it("writes a line as the table's debit and credit columns", () => {
    expect(toColumns(debit("1000", 5n))).toEqual({
      debitMinor: 5n,
      creditMinor: 0n,
    });
    expect(toColumns(credit("1000", 5n))).toEqual({
      debitMinor: 0n,
      creditMinor: 5n,
    });
  });

  it("reads a row back into a line", () => {
    expect(
      fromColumns({ accountCode: "4100", debitMinor: 0n, creditMinor: 7n })
    ).toEqual(credit("4100", 7n));
    expect(
      fromColumns({
        accountCode: "1100",
        debitMinor: 7n,
        creditMinor: 0n,
        memo: "x",
      })
    ).toEqual({ ...debit("1100", 7n), memo: "x" });
  });

  it("refuses a row with both or neither column set, as the table's CHECK does", () => {
    expect(() =>
      fromColumns({ accountCode: "1000", debitMinor: 1n, creditMinor: 1n })
    ).toThrow(RangeError);
    expect(() =>
      fromColumns({ accountCode: "1000", debitMinor: 0n, creditMinor: 0n })
    ).toThrow(RangeError);
  });
});
