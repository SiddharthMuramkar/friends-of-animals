// Amounts finance types into a manual entry. The ledger keeps money as a
// bigint of paise in INR (#55), so a typed rupee amount is read digit by
// digit, never through a float. Pure; no imports.

/**
 * The largest amount one line may carry: Rs 100 crore. Far above anything
 * FOA posts, so it only catches typos (an extra row of zeros). A default;
 * HR-47 may change it.
 */
export const MAX_ENTRY_AMOUNT_MINOR = 100_000_000_000n;

export type ParsedAmount =
  | { ok: true; amountMinor: bigint }
  | { ok: false; error: "invalid_amount" | "not_positive" | "too_large" };

// Digits with optional comma grouping (Indian 1,23,456 or western 123,456),
// then up to two decimals.
const RUPEES = /^(\d+(?:,\d+)*)(?:\.(\d{1,2}))?$/;
const PREFIX = /^(?:₹|rs\.?)\s*/i;

/** Reads "₹ 1,23,456.78", "Rs 2500" or "1234.5" as paise. */
export function parseRupees(input: string): ParsedAmount {
  const match = RUPEES.exec(input.trim().replace(PREFIX, ""));
  if (!match) return { ok: false, error: "invalid_amount" };
  const rupees = BigInt(match[1]!.replaceAll(",", ""));
  const paise = BigInt((match[2] ?? "").padEnd(2, "0"));
  const amountMinor = rupees * 100n + paise;
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
