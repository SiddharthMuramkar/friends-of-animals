// Lot codes (#131): `LOT-{YY}-{5}`, such as `LOT-27-8H3TZ`. YY is the year
// the lot was created, in IST, and the five symbols are random Crockford
// base32 drawn by the codes module (#73) with its collision retry:
//
//   withUniqueCode({ format: lotCodeFormat(now), constraint }, insertLot)
//
// The format has the same shape as the codes module's `CodeFormat`.
//
// Loads under plain Node (schema, seed script): no "server-only", no `@/`
// imports.

/** India keeps UTC+05:30 all year, with no daylight saving. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** How many random symbols follow the prefix. */
export const LOT_CODE_LENGTH = 5;

/** A whole lot code: Crockford base32 has no I, L, O or U. */
export const LOT_CODE_PATTERN = /^LOT-\d{2}-[0-9A-HJKMNP-TV-Z]{5}$/;

/** The code format for a lot created at `createdAt`. */
export function lotCodeFormat(createdAt: Date): {
  prefix: string;
  length: typeof LOT_CODE_LENGTH;
} {
  const ms = createdAt.getTime();
  if (Number.isNaN(ms)) throw new RangeError("lotCodeFormat: invalid Date");
  const istYear = new Date(ms + IST_OFFSET_MS).getUTCFullYear();
  const yy = String(istYear % 100).padStart(2, "0");
  return { prefix: `LOT-${yy}-`, length: LOT_CODE_LENGTH };
}

/**
 * The lot code in `raw` (a URL segment or a typed search), trimmed and
 * upper-cased, or null when it isn't one.
 */
export function parseLotCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return LOT_CODE_PATTERN.test(code) ? code : null;
}
