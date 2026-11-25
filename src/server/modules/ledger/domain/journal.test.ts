import { describe, expect, it } from "vitest";

import {
  buildJournalCsv,
  formatMinorAsDecimal,
  JOURNAL_COLUMNS,
  UnbalancedJournalError,
  type JournalPosting,
} from "./journal";

describe("formatMinorAsDecimal", () => {
  it.each([
    [0n, "0.00"],
    [5n, "0.05"],
    [125_050n, "1250.50"],
    [100_000_000n, "1000000.00"],
    [-5n, "-0.05"],
    [-125_050n, "-1250.50"],
  ])("writes %s paise as %s", (minor, expected) => {
    expect(formatMinorAsDecimal(minor)).toBe(expected);
  });
});

const posting = (
  overrides: Partial<JournalPosting> & Pick<JournalPosting, "seq">
): JournalPosting => ({
  occurredAt: new Date("2026-11-10T06:00:00.000Z"),
  periodMonth: "2026-11",
  narration: "Registration fee",
  sourceType: "payment_capture",
  sourceRef: "pay_TEST0001",
  reversalOfSeq: null,
  lateAdjustment: false,
  lines: [
    {
      accountCode: "1100",
      accountName: "Gateway clearing",
      debitMinor: 50_000n,
      creditMinor: 0n,
      memo: null,
    },
    {
      accountCode: "4100",
      accountName: "Registration fees",
      debitMinor: 0n,
      creditMinor: 50_000n,
      memo: null,
    },
  ],
  ...overrides,
});

const BOM = "﻿";

describe("buildJournalCsv", () => {
  it("writes a header, one row per line in journal order, and a totals row", () => {
    const result = buildJournalCsv([
      posting({
        seq: 8n,
        occurredAt: new Date("2026-11-20T18:45:00.000Z"),
        narration: "Refund",
        sourceType: "refund",
        sourceRef: "rfnd_TEST0001",
        reversalOfSeq: 7n,
        lines: [
          {
            accountCode: "4100",
            accountName: "Registration fees",
            debitMinor: 20_000n,
            creditMinor: 0n,
            memo: "Part refund, one student",
          },
          {
            accountCode: "1100",
            accountName: "Gateway clearing",
            debitMinor: 0n,
            creditMinor: 20_000n,
            memo: null,
          },
        ],
      }),
      posting({ seq: 7n }),
    ]);

    expect(result.totals).toEqual({
      debitMinor: 70_000n,
      creditMinor: 70_000n,
    });
    expect(result.postingCount).toBe(2);
    expect(result.lineCount).toBe(4);
    expect(result.csv.split("\r\n")).toEqual([
      `${BOM}${JOURNAL_COLUMNS.join(",")}`,
      "7,2026-11-10,2026-11,1100,Gateway clearing,500.00,0.00,Registration fee,,payment_capture,pay_TEST0001,,false",
      "7,2026-11-10,2026-11,4100,Registration fees,0.00,500.00,Registration fee,,payment_capture,pay_TEST0001,,false",
      // 18:45 UTC on the 20th is already the 21st in India.
      '8,2026-11-21,2026-11,4100,Registration fees,200.00,0.00,Refund,"Part refund, one student",refund,rfnd_TEST0001,7,false',
      "8,2026-11-21,2026-11,1100,Gateway clearing,0.00,200.00,Refund,,refund,rfnd_TEST0001,7,false",
      "TOTAL,,,,,700.00,700.00,,,,,,",
      "",
    ]);
  });

  it("has the journal columns the accountant expects", () => {
    expect(JOURNAL_COLUMNS).toEqual([
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
    ]);
  });

  it("marks a late adjustment and keeps the period it counts in", () => {
    const { csv } = buildJournalCsv([
      posting({
        seq: 9n,
        occurredAt: new Date("2026-10-30T06:00:00.000Z"),
        periodMonth: "2026-11",
        lateAdjustment: true,
      }),
    ]);
    expect(csv).toContain(
      "9,2026-10-30,2026-11,1100,Gateway clearing,500.00,0.00,Registration fee,,payment_capture,pay_TEST0001,,true"
    );
  });

  it("writes text that looks like a formula as text", () => {
    const { csv } = buildJournalCsv([
      posting({
        seq: 1n,
        narration: "=HYPERLINK(1)",
        lines: [
          {
            accountCode: "5100",
            accountName: "+Prizes",
            debitMinor: 100n,
            creditMinor: 0n,
            memo: "@cmd",
          },
          {
            accountCode: "1000",
            accountName: "Bank account",
            debitMinor: 0n,
            creditMinor: 100n,
            memo: null,
          },
        ],
      }),
    ]);
    expect(csv).toContain(",'+Prizes,1.00,0.00,'=HYPERLINK(1),'@cmd,");
  });

  it("writes just the header and a zero totals row for an empty range", () => {
    const result = buildJournalCsv([]);
    expect(result.totals).toEqual({ debitMinor: 0n, creditMinor: 0n });
    expect(result.csv).toBe(
      `${BOM}${JOURNAL_COLUMNS.join(",")}\r\nTOTAL,,,,,0.00,0.00,,,,,,\r\n`
    );
  });

  it("refuses a posting whose debits and credits differ, naming it", () => {
    const unbalanced = posting({
      seq: 42n,
      lines: [
        {
          accountCode: "1100",
          accountName: "Gateway clearing",
          debitMinor: 10_000n,
          creditMinor: 0n,
          memo: null,
        },
        {
          accountCode: "4100",
          accountName: "Registration fees",
          debitMinor: 0n,
          creditMinor: 9_000n,
          memo: null,
        },
      ],
    });
    expect(() => buildJournalCsv([posting({ seq: 1n }), unbalanced])).toThrow(
      UnbalancedJournalError
    );
    expect(() => buildJournalCsv([unbalanced])).toThrow(/42/);
  });
});
