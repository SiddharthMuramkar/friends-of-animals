// Which accounts an automatic posting uses. Each source of money (an online
// capture, an offline payment, a refund) has one rule here, so the
// consumers that react to Payments events and the backfill post exactly the
// same lines. Later sources (donations #106-#108, auctions #133) add their
// own rules and source types. Pure: no I/O.

import { SYSTEM_ACCOUNT_CODES as CODES } from "./chart";
import { checkLines, type LineDraft, reverseLines } from "./posting";

/**
 * Where a posting came from. With `source_id` it is the posting's
 * idempotency key: one posting per source, so a replayed event, a re-run
 * backfill or a second consumer finds the posting already there.
 */
export const LEDGER_SOURCE_TYPES = [
  /** A gateway payment that captured a payment batch; id = gateway payment id. */
  "payment_capture",
  /** An offline payment finance recorded (#79); id = offline payment id. */
  "offline_payment",
  /** A processed refund (#80); id = refund id. */
  "refund",
  /** Finance's manual entry; id = the posting's own id. */
  "manual",
  /** Finance reversing a manual entry; id = the reversed posting's id. */
  "reversal",
] as const;

export type LedgerSourceType = (typeof LEDGER_SOURCE_TYPES)[number];

export function isLedgerSourceType(value: string): value is LedgerSourceType {
  return (LEDGER_SOURCE_TYPES as readonly string[]).includes(value);
}

/** How money reached FOA, or left it. Offline methods are #79's. */
export type MoneyMethod = "gateway" | "bank_transfer" | "cheque" | "cash";

/** The asset account money lands in, or leaves from, by method. */
export function assetAccountFor(method: MoneyMethod): string {
  switch (method) {
    case "gateway":
      return CODES.gatewayClearing;
    case "cash":
      return CODES.cash;
    case "bank_transfer":
    case "cheque":
      return CODES.bank;
  }
}

/** A registration-fee capture: debit where the money landed, credit fees. */
export function registrationCaptureLines(input: {
  amountMinor: bigint;
  method: MoneyMethod;
}): LineDraft[] {
  if (input.amountMinor <= 0n) {
    throw new RangeError("A capture posts a positive amount");
  }
  return [
    {
      accountCode: assetAccountFor(input.method),
      side: "debit",
      amountMinor: input.amountMinor,
    },
    {
      accountCode: CODES.registrationFees,
      side: "credit",
      amountMinor: input.amountMinor,
    },
  ];
}

export type RefundLinesResult =
  | { ok: true; lines: LineDraft[] }
  | {
      ok: false;
      error: "not_positive" | "exceeds_capture" | "unsupported_capture";
    };

/**
 * A refund's lines: the capture's lines mirrored, for the refunded amount.
 * The money leaves through the refund's own method when it has one (a cash
 * payment refunded by bank transfer), else the way it came in. Refunds of
 * one capture never add up to more than it.
 */
export function refundLines(input: {
  /** The lines of the capture posting being refunded. */
  capture: readonly LineDraft[];
  amountMinor: bigint;
  /** What earlier refunds of this capture already posted. */
  alreadyRefundedMinor: bigint;
  method?: MoneyMethod;
}): RefundLinesResult {
  const { capture, amountMinor, alreadyRefundedMinor, method } = input;
  if (amountMinor <= 0n) return { ok: false, error: "not_positive" };
  const checked = checkLines(capture);
  const debit = capture.find((line) => line.side === "debit");
  const credit = capture.find((line) => line.side === "credit");
  if (!checked.ok || capture.length !== 2 || !debit || !credit) {
    return { ok: false, error: "unsupported_capture" };
  }
  if (alreadyRefundedMinor + amountMinor > checked.totalMinor) {
    return { ok: false, error: "exceeds_capture" };
  }
  const [incomeLine, assetLine] = reverseLines([credit, debit]) as [
    LineDraft,
    LineDraft,
  ];
  return {
    ok: true,
    lines: [
      {
        accountCode: incomeLine.accountCode,
        side: incomeLine.side,
        amountMinor,
      },
      {
        accountCode: method ? assetAccountFor(method) : assetLine.accountCode,
        side: assetLine.side,
        amountMinor,
      },
    ],
  };
}
