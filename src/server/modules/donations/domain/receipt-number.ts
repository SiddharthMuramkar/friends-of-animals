// Receipt numbers (#106): `FOA-RCPT-{FY}-{000000}`, the one sequential code
// on the platform (#55). The sequence restarts each Indian financial year,
// 1 April to 31 March, counted in IST. The FY token is the two-digit start
// and end years, so 1 April 2026 to 31 March 2027 is `2627` (the default
// until the accountant rules otherwise, HR-47). Allocation itself is a
// counter row locked in the capture transaction, so numbers stay gapless;
// this file only says which year an instant is in and how numbers look.
// Pure; no imports.

/** IST is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** April, as `Date#getUTCMonth()` counts months. */
const APRIL = 3;

/** Six digits: the most receipts one financial year can number. */
export const MAX_RECEIPT_SEQUENCE = 999_999;

export type FinancialYear = {
  /** The calendar year in which this FY's April falls. */
  startYear: number;
  /** The token printed in receipt numbers, e.g. "2627". */
  token: string;
};

const twoDigits = (year: number) => String(year % 100).padStart(2, "0");

/** The Indian financial year that `at` falls in, counted in IST. */
export function financialYearOf(at: Date): FinancialYear {
  const ms = at.getTime();
  if (Number.isNaN(ms)) throw new RangeError("Invalid date");
  const ist = new Date(ms + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const startYear = ist.getUTCMonth() >= APRIL ? year : year - 1;
  return { startYear, token: twoDigits(startYear) + twoDigits(startYear + 1) };
}

/** A token like "2627": two consecutive years' last two digits. */
function isFinancialYearToken(token: string): boolean {
  if (!/^\d{4}$/.test(token)) return false;
  const start = Number(token.slice(0, 2));
  const end = Number(token.slice(2));
  return (start + 1) % 100 === end;
}

/** The receipt number for the `seq`th receipt of financial year `fy`. */
export function formatReceiptNumber(fy: string, seq: number): string {
  if (!isFinancialYearToken(fy)) {
    throw new RangeError(`Not a financial-year token: ${JSON.stringify(fy)}`);
  }
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_RECEIPT_SEQUENCE) {
    throw new RangeError(
      `Receipt sequence must be 1 to ${MAX_RECEIPT_SEQUENCE}, got ${seq}`
    );
  }
  return `FOA-RCPT-${fy}-${String(seq).padStart(6, "0")}`;
}

const RECEIPT_NUMBER = /^FOA-RCPT-(\d{4})-(\d{6})$/;

/**
 * Reads a receipt number a donor typed, or null if it isn't one. Spaces
 * around it and lower case are forgiven.
 */
export function parseReceiptNumber(
  input: string
): { fy: string; seq: number } | null {
  const match = RECEIPT_NUMBER.exec(input.trim().toUpperCase());
  if (!match) return null;
  const [, fy, digits] = match;
  const seq = Number(digits);
  if (!isFinancialYearToken(fy!) || seq < 1) return null;
  return { fy: fy!, seq };
}
