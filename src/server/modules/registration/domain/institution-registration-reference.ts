// The reference an institution gets when it registers for a competition
// (#75): the competition's code, "I", and five random Crockford base32
// symbols, for example PAWS26-I-Q2W9R. The symbols come from the codes
// module (#73), never from personal data.
//
// Pure: no randomness here; the caller passes the symbols.

/** How many random symbols follow "-I-". */
export const REFERENCE_SYMBOL_COUNT = 5;

const COMPETITION_CODE = /^[A-Z]{3,6}\d{2}$/;
/** Crockford base32: digits and capitals without I, L, O and U. */
const SYMBOLS = /^[0-9A-HJKMNP-TV-Z]{5}$/;

/** Every well-formed institution registration reference. */
export const INSTITUTION_REFERENCE_PATTERN =
  /^[A-Z]{3,6}\d{2}-I-[0-9A-HJKMNP-TV-Z]{5}$/;

/** Builds a reference. Throws RangeError on a malformed code or symbols. */
export function formatInstitutionRegistrationReference(
  competitionCode: string,
  symbols: string
): string {
  if (!COMPETITION_CODE.test(competitionCode)) {
    throw new RangeError(`Not a competition code: ${competitionCode}`);
  }
  if (!SYMBOLS.test(symbols)) {
    throw new RangeError(
      `Expected ${REFERENCE_SYMBOL_COUNT} Crockford base32 symbols`
    );
  }
  return `${competitionCode}-I-${symbols}`;
}

export type ParsedReference = {
  reference: string;
  competitionCode: string;
  symbols: string;
};

const TYPED_REFERENCE = /^([A-Z]{3,6}\d{2})-I-([0-9A-Z]{5})$/;

/**
 * Reads a reference someone typed or a URL carried: case and surrounding
 * spaces are ignored, and the look-alikes O, I and L in the symbols are
 * read as 0, 1 and 1, as Crockford base32 decodes them. Returns null for
 * anything that is not a reference.
 */
export function parseInstitutionRegistrationReference(
  text: string
): ParsedReference | null {
  const match = TYPED_REFERENCE.exec(text.trim().toUpperCase());
  if (!match) return null;
  const competitionCode = match[1]!;
  const symbols = match[2]!.replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!SYMBOLS.test(symbols)) return null;
  return {
    reference: `${competitionCode}-I-${symbols}`,
    competitionCode,
    symbols,
  };
}
