import { describe, expect, it } from "vitest";

import { SYSTEM_ACCOUNT_CODES as CODES } from "./chart";
import { checkLines, type LineDraft } from "./posting";
import {
  assetAccountFor,
  donationCaptureLines,
  foreignDonationLines,
  LEDGER_SOURCE_TYPES,
  isLedgerSourceType,
  refundLines,
  registrationCaptureLines,
} from "./posting-rules";

describe("assetAccountFor()", () => {
  it("puts gateway money in gateway clearing, cash in cash, and the rest in the bank", () => {
    expect(assetAccountFor("gateway")).toBe(CODES.gatewayClearing);
    expect(assetAccountFor("cash")).toBe(CODES.cash);
    expect(assetAccountFor("bank_transfer")).toBe(CODES.bank);
    expect(assetAccountFor("cheque")).toBe(CODES.bank);
  });
});

describe("registrationCaptureLines()", () => {
  it("debits where the money landed and credits registration fees", () => {
    expect(
      registrationCaptureLines({ amountMinor: 150000n, method: "gateway" })
    ).toEqual([
      {
        accountCode: CODES.gatewayClearing,
        side: "debit",
        amountMinor: 150000n,
      },
      {
        accountCode: CODES.registrationFees,
        side: "credit",
        amountMinor: 150000n,
      },
    ]);
  });

  it.each(["gateway", "bank_transfer", "cheque", "cash"] as const)(
    "is always balanced (%s)",
    (method) => {
      const lines = registrationCaptureLines({ amountMinor: 1n, method });
      expect(checkLines(lines)).toEqual({ ok: true, totalMinor: 1n });
    }
  );

  it("refuses a zero or negative capture", () => {
    expect(() =>
      registrationCaptureLines({ amountMinor: 0n, method: "gateway" })
    ).toThrow(RangeError);
  });
});

describe("refundLines()", () => {
  const capture: LineDraft[] = registrationCaptureLines({
    amountMinor: 300000n,
    method: "gateway",
  });

  it("mirrors the capture for the refunded amount", () => {
    expect(
      refundLines({ capture, amountMinor: 100000n, alreadyRefundedMinor: 0n })
    ).toEqual({
      ok: true,
      lines: [
        {
          accountCode: CODES.registrationFees,
          side: "debit",
          amountMinor: 100000n,
        },
        {
          accountCode: CODES.gatewayClearing,
          side: "credit",
          amountMinor: 100000n,
        },
      ],
    });
  });

  it("pays out of the refund's own method when it differs from the capture's", () => {
    const cashCapture = registrationCaptureLines({
      amountMinor: 5000n,
      method: "cash",
    });
    const result = refundLines({
      capture: cashCapture,
      amountMinor: 5000n,
      alreadyRefundedMinor: 0n,
      method: "bank_transfer",
    });
    expect(result.ok && result.lines[1]).toEqual({
      accountCode: CODES.bank,
      side: "credit",
      amountMinor: 5000n,
    });
  });

  it("allows partial refunds up to the captured amount, and no further", () => {
    expect(
      refundLines({
        capture,
        amountMinor: 100000n,
        alreadyRefundedMinor: 200000n,
      }).ok
    ).toBe(true);
    expect(
      refundLines({ capture, amountMinor: 1n, alreadyRefundedMinor: 300000n })
    ).toEqual({ ok: false, error: "exceeds_capture" });
  });

  it("refuses a zero refund", () => {
    expect(
      refundLines({ capture, amountMinor: 0n, alreadyRefundedMinor: 0n })
    ).toEqual({ ok: false, error: "not_positive" });
  });

  it("refuses a capture that isn't one debit and one credit", () => {
    const split: LineDraft[] = [
      { accountCode: "1000", side: "debit", amountMinor: 2n },
      { accountCode: "4100", side: "credit", amountMinor: 1n },
      { accountCode: "4900", side: "credit", amountMinor: 1n },
    ];
    expect(
      refundLines({ capture: split, amountMinor: 1n, alreadyRefundedMinor: 0n })
    ).toEqual({ ok: false, error: "unsupported_capture" });
  });
});

describe("donation postings (#106)", () => {
  it.each([
    ["individual", "4200"],
    ["corporate", "4210"],
    ["csr", "4220"],
  ] as const)("credits a %s donation to %s", (donorType, income) => {
    expect(
      donationCaptureLines({
        amountMinor: 50_000n,
        method: "gateway",
        donorType,
      })
    ).toEqual([
      { accountCode: "1100", side: "debit", amountMinor: 50_000n },
      { accountCode: income, side: "credit", amountMinor: 50_000n },
    ]);
  });

  it("holds foreign money as owed back, never as income", () => {
    expect(foreignDonationLines({ amountMinor: 50_000n })).toEqual([
      { accountCode: "1100", side: "debit", amountMinor: 50_000n },
      { accountCode: "2100", side: "credit", amountMinor: 50_000n },
    ]);
  });

  it("returns foreign money by mirroring its posting", () => {
    expect(
      refundLines({
        capture: foreignDonationLines({ amountMinor: 50_000n }),
        amountMinor: 50_000n,
        alreadyRefundedMinor: 0n,
      })
    ).toEqual({
      ok: true,
      lines: [
        { accountCode: "2100", side: "debit", amountMinor: 50_000n },
        { accountCode: "1100", side: "credit", amountMinor: 50_000n },
      ],
    });
  });
});

describe("ledger source types", () => {
  it("names where each posting came from", () => {
    expect(LEDGER_SOURCE_TYPES).toEqual([
      "payment_capture",
      "offline_payment",
      "refund",
      "donation",
      "foreign_donation",
      "recurring_after_cancel",
      "manual",
      "reversal",
    ]);
    expect(isLedgerSourceType("refund")).toBe(true);
    expect(isLedgerSourceType("donation_capture")).toBe(false);
  });
});
