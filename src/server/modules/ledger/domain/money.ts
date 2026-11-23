// Amounts finance types into a manual entry. The ledger keeps money as a
// bigint of paise in INR (#55), so a typed rupee amount is read digit by
// digit, never through a float.

import { parseRupeesToPaise } from "../../competitions/domain/fees";

/**
 * The largest amount one line may carry: Rs 100 crore. Far above anything
 * FOA posts, so it only catches typos (an extra row of zeros). A default;
 * HR-47 may change it.
 */
export const MAX_ENTRY_AMOUNT_MINOR = 100_000_000_000n;

export type ParsedAmount =
  | { ok: true; amountMinor: bigint }
  | { ok: false; error: "invalid_amount" | "not_positive" | "too_large" };

/** Reads "₹ 1,23,456.78", "Rs 2500" or "1234.5" as paise. */
export function parseRupees(input: string): ParsedAmount {
  const parsed = parseRupeesToPaise(input.trim().replace(/^rs\.?\s*/i, "₹"));
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error === "empty" ? "invalid_amount" : parsed.error,
    };
  }
  const amountMinor = parsed.paise;
  if (amountMinor <= 0n) return { ok: false, error: "not_positive" };
  if (amountMinor > MAX_ENTRY_AMOUNT_MINOR) {
    return { ok: false, error: "too_large" };
  }
  return { ok: true, amountMinor };
}

/** Paise as plain rupees for a form field ("1234.50"); `parseRupees` reads it back. */
export function rupeesForInput(amountMinor: bigint): string {
  if (amountMinor < 0n) throw new RangeError("Amount must not be negative");
  const rupees = amountMinor / 100n;
  const paise = (amountMinor % 100n).toString().padStart(2, "0");
  return `${rupees}.${paise}`;
}
