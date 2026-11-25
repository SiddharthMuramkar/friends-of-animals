// The Artwork ID (#93): the competition code, `-A-` and six random
// Crockford base32 symbols, such as `PAWS26-A-8H3TZ0`. The codes module
// draws the symbols and retries on a collision; this file says what the
// code looks like and reads one back from what staff type.
//
// Loads under plain Node: no "server-only", no `@/` imports.

/** A competition code: 3 to 6 capital letters and a two-digit year. */
const COMPETITION_CODE = /^[A-Z]{3,6}\d{2}$/;

/** A stored Artwork ID. */
export const ARTWORK_CODE_PATTERN = /^[A-Z]{3,6}\d{2}-A-[0-9A-HJKMNP-TV-Z]{6}$/;

const SEPARATOR = "-A-";

/** The code format the codes module draws Artwork IDs in. */
export function artworkCodeFormat(competitionCode: string): {
  prefix: string;
  length: 6;
} {
  if (!COMPETITION_CODE.test(competitionCode)) {
    throw new RangeError(
      `Not a competition code: ${JSON.stringify(competitionCode)}`
    );
  }
  return { prefix: competitionCode + SEPARATOR, length: 6 };
}

/**
 * The stored Artwork ID that `input` names, or null if it names none.
 * Ignores case and spaces, and reads I and L as 1 and O as 0 in the six
 * random symbols, as Crockford base32 does. The competition code keeps its
 * letters.
 */
export function normaliseArtworkCode(input: string): string | null {
  const compact = input.replace(/\s+/g, "").toUpperCase();
  const parts = compact.split(SEPARATOR);
  if (parts.length !== 2) return null;
  const [competitionCode = "", symbols = ""] = parts;
  const code =
    competitionCode +
    SEPARATOR +
    symbols.replace(/[IL]/g, "1").replace(/O/g, "0");
  return ARTWORK_CODE_PATTERN.test(code) ? code : null;
}
