// A posting is one balanced journal entry: two or more lines, each moving a
// positive amount onto one side of one account, with debits equal to
// credits. This file holds the rules every posting obeys, wherever it comes
// from (a payment, a refund, finance's manual entry). The database enforces
// the same rules again (CHECK constraints and a deferred balance trigger),
// so a bug here can't commit an unbalanced posting. Pure; no imports.

export type Side = "debit" | "credit";

/** One line of a posting, before it is written. Accounts go by code. */
export type LineDraft = {
  accountCode: string;
  side: Side;
  /** Paise; always positive. */
  amountMinor: bigint;
  memo?: string;
};

/**
 * The most lines one posting may hold. Real entries have two to a handful;
 * the cap keeps a form or a bug from writing hundreds.
 */
export const MAX_LINES = 20;

export type LinesCheck =
  | { ok: true; totalMinor: bigint }
  | { ok: false; error: "too_few_lines" | "too_many_lines" }
  | {
      ok: false;
      error: "non_positive_amount" | "missing_account";
      lineIndex: number;
    }
  | { ok: false; error: "unbalanced"; debitMinor: bigint; creditMinor: bigint };

/** Whether `lines` make a valid posting; if so, its total (either side). */
export function checkLines(lines: readonly LineDraft[]): LinesCheck {
  if (lines.length < 2) return { ok: false, error: "too_few_lines" };
  if (lines.length > MAX_LINES) return { ok: false, error: "too_many_lines" };
  let debitMinor = 0n;
  let creditMinor = 0n;
  for (const [lineIndex, line] of lines.entries()) {
    if (line.accountCode.trim() === "") {
      return { ok: false, error: "missing_account", lineIndex };
    }
    if (line.amountMinor <= 0n) {
      return { ok: false, error: "non_positive_amount", lineIndex };
    }
    if (line.side === "debit") debitMinor += line.amountMinor;
    else creditMinor += line.amountMinor;
  }
  if (debitMinor !== creditMinor) {
    return { ok: false, error: "unbalanced", debitMinor, creditMinor };
  }
  return { ok: true, totalMinor: debitMinor };
}

const OTHER_SIDE: Record<Side, Side> = { debit: "credit", credit: "debit" };

/** The lines of a reversal: the same accounts and amounts, sides swapped. */
export function reverseLines(lines: readonly LineDraft[]): LineDraft[] {
  return lines.map((line) => ({ ...line, side: OTHER_SIDE[line.side] }));
}

/** A line as the table stores it: exactly one of the two columns is set. */
export type LineColumns = { debitMinor: bigint; creditMinor: bigint };

export function toColumns(line: LineDraft): LineColumns {
  return line.side === "debit"
    ? { debitMinor: line.amountMinor, creditMinor: 0n }
    : { debitMinor: 0n, creditMinor: line.amountMinor };
}

/** Reads a stored line back. Throws on a row the table's CHECK forbids. */
export function fromColumns(
  row: LineColumns & { accountCode: string; memo?: string | null }
): LineDraft {
  const { accountCode, debitMinor, creditMinor, memo } = row;
  const memoPart = memo ? { memo } : {};
  if (debitMinor > 0n && creditMinor === 0n) {
    return { accountCode, side: "debit", amountMinor: debitMinor, ...memoPart };
  }
  if (creditMinor > 0n && debitMinor === 0n) {
    return {
      accountCode,
      side: "credit",
      amountMinor: creditMinor,
      ...memoPart,
    };
  }
  throw new RangeError(
    `A ledger line sets exactly one of debit and credit (account ${accountCode})`
  );
}
