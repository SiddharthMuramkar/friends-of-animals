// PAN, the Indian income-tax Permanent Account Number (#108). Donors give
// it only while FOA can issue tax-exemption receipts (./tax-exemption.ts).
// A PAN is stored encrypted and never logged, put in an audit row or kept
// in clear in a receipt snapshot: snapshots hold `maskPan`'s output.
//
// Loads under plain Node (drizzle-kit and the seed script read what the
// schema imports): no imports at all.

/** A PAN in its one stored form: ten upper-case ASCII characters. */
export type Pan = string & { readonly __brand: "Pan" };

/**
 * The fourth character says who holds the PAN: P a person, C a company,
 * H a Hindu undivided family, F a firm or LLP, A an association of persons,
 * T a trust, B a body of individuals, L a local authority, J an artificial
 * juridical person, G a government body.
 */
const HOLDER_TYPES = "PCHFATBLJG";

const PAN = new RegExp(`^[A-Z]{3}[${HOLDER_TYPES}][A-Z][0-9]{4}[A-Z]$`);

/**
 * Reads a PAN as a donor or finance typed it, or null if it isn't one.
 * Lower case and spaces (around it or between its groups) are forgiven;
 * any other punctuation is not.
 */
export function parsePan(input: string): Pan | null {
  const compact = input.replace(/\s+/g, "");
  // Checked before upper-casing: "ſ" and "ı" upper-case to ASCII S and I.
  if (!/^[A-Za-z0-9]{10}$/.test(compact)) return null;
  const pan = compact.toUpperCase();
  return PAN.test(pan) ? (pan as Pan) : null;
}

/**
 * The PAN as a receipt snapshot, a screen or an email may show it: only
 * the last four characters, so a leaked receipt link doesn't give it away.
 */
export function maskPan(pan: Pan): string {
  return `XXXXXX${pan.slice(-4)}`;
}
