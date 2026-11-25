// The human reference of a rights request (#115), such as `PR-27-8H3TZQ`:
// "PR", the two-digit year it was filed in (India's calendar), then six
// random Crockford base32 symbols. Requesters quote it to the grievance
// officer; it is never derived from personal data, and the internal id
// stays a UUIDv7. The returned format plugs into the shared code generator
// (#73's `withUniqueCode`), which draws the symbols and retries on a clash.
//
// Pure, and loads under plain Node.

/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const SYMBOLS = 6;

/** The same shape as the shared code generator's `CodeFormat`. */
export type RequestReferenceFormat = { prefix: string; length: number };

/** The reference format for a request filed at `filedAt`. */
export function requestReferenceFormat(filedAt: Date): RequestReferenceFormat {
  const year = new Date(filedAt.getTime() + IST_OFFSET_MS).getUTCFullYear();
  const yy = String(year % 100).padStart(2, "0");
  return { prefix: `PR-${yy}-`, length: SYMBOLS };
}

const REFERENCE = /^PR-\d{2}-[0-9A-HJKMNP-TV-Z]{6}$/;

/** Whether `text` (trimmed, any case) is a request reference. */
export function isRequestReference(text: string): boolean {
  return REFERENCE.test(text.trim().toUpperCase());
}
