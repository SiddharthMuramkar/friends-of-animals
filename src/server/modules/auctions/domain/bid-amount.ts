// Reading the amount a bidder types. Bids are whole rupees, written with or
// without digit grouping (1,50,000 or 150,000) and an optional ₹ or Rs
// prefix, and stored as bigint paise (#55). A bid is binding, so amounts
// longer than MAX_BID_RUPEE_DIGITS digits are refused outright rather than
// trusted. Pure; no imports.

/** At most ₹99,99,99,999 (just under ₹100 crore). */
export const MAX_BID_RUPEE_DIGITS = 9;

const PREFIX = /^(?:₹|rs\.?)\s*/i;
/** Digits, with single commas only between digits. */
const GROUPED_DIGITS = /^\d+(?:,\d+)*$/;

/** The bid in paise, or null when the text isn't a positive whole-rupee amount. */
export function parseBidRupees(text: string): bigint | null {
  const body = text.trim().replace(PREFIX, "");
  if (!GROUPED_DIGITS.test(body)) return null;
  const digits = body.replaceAll(",", "").replace(/^0+/, "");
  if (digits === "" || digits.length > MAX_BID_RUPEE_DIGITS) return null;
  return BigInt(digits) * 100n;
}
