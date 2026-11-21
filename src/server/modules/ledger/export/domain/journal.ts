// The accountant's export (#109): every ledger line in a date range as a
// journal CSV, one row per line, with a totals row. Debits always equal
// credits, because every posting balances; the export checks that again
// and refuses to write an unbalanced file. Dates are calendar days in
// India. Pure: the caller loads the postings whose instant falls in
// `istDayRange(...)` and maps them to `JournalPosting`.
//
// The columns are a default until FOA's accountant picks the format (a CSV
// journal or a Tally import).

import { decimalCell, toCsv, type CsvCell } from "@/server/lib/csv";

/** IST is UTC+05:30 all year. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Paise as rupees with two decimals: 125050n -> "1250.50". */
export function formatMinorAsDecimal(amountMinor: bigint): string {
  const sign = amountMinor < 0n ? "-" : "";
  const abs = amountMinor < 0n ? -amountMinor : amountMinor;
  const paise = (abs % 100n).toString().padStart(2, "0");
  return `${sign}${abs / 100n}.${paise}`;
}

/** The calendar date in India at `instant`, `YYYY-MM-DD`. */
export function istDate(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istMidnight(date: string): Date {
  const match = IST_DATE.exec(date);
  const utc = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : Number.NaN;
  // Date.UTC rolls 31 Nov over to 1 Dec; a real date round-trips.
  if (Number.isNaN(utc) || new Date(utc).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${date}`);
  }
  return new Date(utc - IST_OFFSET_MS);
}

/**
 * The instants covered by IST days `from` to `to`, both included: postings
 * with `start <= occurred_at < endExclusive`.
 */
export function istDayRange(input: { from: string; to: string }): {
  start: Date;
  endExclusive: Date;
} {
  const start = istMidnight(input.from);
  const last = istMidnight(input.to);
  if (last.getTime() < start.getTime()) {
    throw new RangeError(
      `Range ends before it starts: ${input.from} .. ${input.to}`
    );
  }
  return { start, endExclusive: new Date(last.getTime() + DAY_MS) };
}

export type JournalLine = {
  accountCode: string;
  accountName: string;
  debitMinor: bigint;
  creditMinor: bigint;
};

export type JournalPosting = {
  /** The posting's journal number. */
  seq: bigint;
  occurredAt: Date;
  /** The month it was posted to, `YYYY-MM`; later than `occurredAt` for a late adjustment. */
  periodMonth: string;
  /** Finance's description. No personal data beyond what finance typed. */
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

/** The journal CSV for `postings`, in journal (seq) order. */
export function buildJournalCsv(
  postings: readonly JournalPosting[]
): JournalCsv {
  const ordered = [...postings].sort((a, b) =>
    a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0
  );
  const rows: CsvCell[][] = [[...JOURNAL_COLUMNS]];
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
        posting.seq,
        istDate(posting.occurredAt),
        posting.periodMonth,
        line.accountCode,
        line.accountName,
        decimalCell(formatMinorAsDecimal(line.debitMinor)),
        decimalCell(formatMinorAsDecimal(line.creditMinor)),
        posting.narration,
        posting.sourceType,
        posting.sourceRef,
        posting.reversalOfSeq,
        posting.lateAdjustment ? "true" : "false",
      ]);
    }
    if (debits !== credits) throw new UnbalancedJournalError(posting.seq);
    debitTotal += debits;
    creditTotal += credits;
  }

  rows.push([
    "TOTAL",
    null,
    null,
    null,
    null,
    decimalCell(formatMinorAsDecimal(debitTotal)),
    decimalCell(formatMinorAsDecimal(creditTotal)),
    null,
    null,
    null,
    null,
    null,
  ]);

  return {
    csv: toCsv(rows),
    totals: { debitMinor: debitTotal, creditMinor: creditTotal },
    postingCount: ordered.length,
    lineCount,
  };
}
