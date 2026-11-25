// The accountant's export (#109): every ledger line in a date range as a
// journal CSV, one row per line, then a totals row. Debits always equal
// credits, because every posting balances; the export checks that again
// and refuses to write an unbalanced file. Dates are calendar days in
// India. Pure: the caller loads the postings and maps them in.
//
// The columns are a default until FOA's accountant picks the format, a CSV
// journal or a Tally import (HR-47).

import {
  BOM,
  formatCsv,
  neutraliseFormula,
} from "../../registration/domain/csv";
import { istDateOf } from "./period";

/** Paise as rupees with two decimals: 125050n -> "1250.50". */
export function formatMinorAsDecimal(amountMinor: bigint): string {
  const sign = amountMinor < 0n ? "-" : "";
  const abs = amountMinor < 0n ? -amountMinor : amountMinor;
  const paise = (abs % 100n).toString().padStart(2, "0");
  return `${sign}${abs / 100n}.${paise}`;
}

export type JournalLine = {
  accountCode: string;
  accountName: string;
  debitMinor: bigint;
  creditMinor: bigint;
  memo: string | null;
};

export type JournalPosting = {
  /** The posting's journal number. */
  seq: bigint;
  occurredAt: Date;
  /** The month it counts in, `YYYY-MM`; later than `occurredAt` for a late adjustment. */
  periodMonth: string;
  /** Finance's or the platform's description. */
  narration: string;
  sourceType: string;
  /** The source's id: a gateway payment id, a refund id, a posting id. */
  sourceRef: string;
  reversalOfSeq: bigint | null;
  lateAdjustment: boolean;
  lines: readonly JournalLine[];
};

export const JOURNAL_COLUMNS = [
  "seq",
  "date_ist",
  "period",
  "account_code",
  "account_name",
  "debit_inr",
  "credit_inr",
  "narration",
  "memo",
  "source_type",
  "source_ref",
  "reversal_of_seq",
  "late_adjustment",
] as const;

export class UnbalancedJournalError extends Error {
  constructor(readonly seq: bigint) {
    super(`Posting ${seq} doesn't balance: its debits and credits differ`);
    this.name = "UnbalancedJournalError";
  }
}

export type JournalCsv = {
  csv: string;
  totals: { debitMinor: bigint; creditMinor: bigint };
  postingCount: number;
  lineCount: number;
};

/**
 * The journal CSV for `postings`, in journal (seq) order. Text a
 * spreadsheet would run as a formula gets a leading quote; amounts never
 * start with one of those characters, so they stay numbers.
 */
export function buildJournalCsv(
  postings: readonly JournalPosting[]
): JournalCsv {
  const ordered = [...postings].sort((a, b) =>
    a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0
  );
  const rows: string[][] = [[...JOURNAL_COLUMNS]];
  let debitTotal = 0n;
  let creditTotal = 0n;
  let lineCount = 0;

  for (const posting of ordered) {
    let debits = 0n;
    let credits = 0n;
    for (const line of posting.lines) {
      debits += line.debitMinor;
      credits += line.creditMinor;
      lineCount += 1;
      rows.push([
        posting.seq.toString(),
        istDateOf(posting.occurredAt),
        posting.periodMonth,
        line.accountCode,
        neutraliseFormula(line.accountName),
        formatMinorAsDecimal(line.debitMinor),
        formatMinorAsDecimal(line.creditMinor),
        neutraliseFormula(posting.narration),
        neutraliseFormula(line.memo ?? ""),
        posting.sourceType,
        neutraliseFormula(posting.sourceRef),
        posting.reversalOfSeq?.toString() ?? "",
        posting.lateAdjustment ? "true" : "false",
      ]);
    }
    if (debits !== credits) throw new UnbalancedJournalError(posting.seq);
    debitTotal += debits;
    creditTotal += credits;
  }

  rows.push([
    "TOTAL",
    "",
    "",
    "",
    "",
    formatMinorAsDecimal(debitTotal),
    formatMinorAsDecimal(creditTotal),
    "",
    "",
    "",
    "",
    "",
    "",
  ]);

  return {
    csv: BOM + formatCsv(rows),
    totals: { debitMinor: debitTotal, creditMinor: creditTotal },
    postingCount: ordered.length,
    lineCount,
  };
}
