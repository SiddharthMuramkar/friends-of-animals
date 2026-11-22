// The internal reference of a safeguarding report (#116), such as
// `SG-27-8H3TZQ`: "SG", the two-digit year it was filed in (India's
// calendar), then six random Crockford base32 symbols. Only safeguarding
// leads see it, to talk about a case without its details; the public
// confirmation never shows it. It is never derived from the report, and the
// internal id stays a UUIDv7. The returned format plugs into the shared code
// generator (#73's `withUniqueCode`), which draws the symbols and retries on
// a clash.
//
// Pure, and loads under plain Node.

/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const SYMBOLS = 6;

/** The same shape as the shared code generator's `CodeFormat`. */
export type ReportReferenceFormat = { prefix: string; length: number };

/** The reference format for a report filed at `filedAt`. */
export function reportReferenceFormat(filedAt: Date): ReportReferenceFormat {
  const year = new Date(filedAt.getTime() + IST_OFFSET_MS).getUTCFullYear();
  const yy = String(year % 100).padStart(2, "0");
  return { prefix: `SG-${yy}-`, length: SYMBOLS };
}

const REFERENCE = /^SG-\d{2}-[0-9A-HJKMNP-TV-Z]{6}$/;

/** Whether `text` (trimmed, any case) is a report reference. */
export function isReportReference(text: string): boolean {
  return REFERENCE.test(text.trim().toUpperCase());
}
