// What the donate form posts (#106), read into what the donation use case
// takes. Pure, so the server action and its test share it without a page.

/** Rupees, with at most two decimals (paise), digits only. */
const RUPEES = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * The paise in an amount a donor typed in rupees, or null if it isn't one.
 * Forgives what people type: spaces, a leading ₹, and digit-group commas
 * in either style (1,00,000 or 100,000). Zero reads as zero; the form
 * refuses it.
 */
export function rupeesToPaise(typed: string): bigint | null {
  const digits = typed.trim().replace(/^₹\s*/, "").replaceAll(",", "");
  const match = RUPEES.exec(digits);
  if (!match) return null;
  const [, rupees, paise = ""] = match;
  return BigInt(rupees!) * 100n + BigInt(paise.padEnd(2, "0"));
}
