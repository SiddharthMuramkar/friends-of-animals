// What a payment batch charges: the sum of its items, in paise. Money is a
// bigint of minor units plus a currency, never a float (#55), and FOA takes
// domestic INR only while FCRA is off. Pure; no imports.

/** An amount of money: bigint minor units (paise for INR). */
export type Money = { amountMinor: bigint; currency: "INR" };

/** One item's charge as the batch reads it from the fee it snapshotted. */
export type ItemAmount = { amountMinor: bigint; currency: string };

export type BatchTotal =
  | { ok: true; total: Money }
  | {
      ok: false;
      reason: "empty_batch" | "negative_amount" | "unsupported_currency";
    };

/**
 * The total a batch's gateway order is for. A zero total means every item is
 * free: the caller confirms the registrations without asking the gateway.
 */
export function batchTotal(items: readonly ItemAmount[]): BatchTotal {
  if (items.length === 0) return { ok: false, reason: "empty_batch" };
  let amountMinor = 0n;
  for (const item of items) {
    if (item.currency !== "INR") {
      return { ok: false, reason: "unsupported_currency" };
    }
    if (item.amountMinor < 0n) return { ok: false, reason: "negative_amount" };
    amountMinor += item.amountMinor;
  }
  return { ok: true, total: { amountMinor, currency: "INR" } };
}
