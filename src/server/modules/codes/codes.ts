// Human-facing codes (#73): random Crockford base32 symbols after a fixed
// prefix, such as the Institution ID `FOA-I-8H3TZ`. Internal ids stay
// UUIDv7 (src/server/ids.ts); a code is never derived from personal data.
// Later codes reuse this module with their own format, for example
// `{ prefix: "PAWS26-R-", length: 6 }`.
//
// Loads under plain Node (seed script), so no "server-only" here.

/** Crockford base32: the digits and letters without I, L, O and U. */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Returns `length` random bytes; tests pass a fixed source. */
export type RandomBytes = (length: number) => Uint8Array;

const cryptoRandomBytes: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

/** A code is `prefix` followed by `length` Crockford base32 symbols. */
export type CodeFormat = { prefix: string; length: number };

/** The Institution ID, given when an institution is first verified. */
export const INSTITUTION_CODE: CodeFormat = { prefix: "FOA-I-", length: 5 };

/** A new random code in `format`. */
export function generateCode(
  format: CodeFormat,
  random: RandomBytes = cryptoRandomBytes
): string {
  // 256 is a multiple of 32, so the low five bits of a uniform byte pick
  // each symbol with equal chance.
  const symbols = Array.from(
    random(format.length),
    (byte) => CROCKFORD_ALPHABET[byte & 31]!
  );
  return format.prefix + symbols.join("");
}

/** Thrown when every attempt drew a code that was already taken. */
export class UniqueCodeExhaustedError extends Error {
  constructor(format: CodeFormat, attempts: number) {
    super(
      `No free ${format.prefix} code after ${attempts} attempts; ` +
        "the code space may be nearly full"
    );
    this.name = "UniqueCodeExhaustedError";
  }
}

const UNIQUE_VIOLATION = "23505";

/**
 * Whether `error` is Postgres refusing a duplicate key on `constraint`.
 * Drizzle wraps driver errors, so the cause chain is searched. PGlite names
 * the constraint `constraint`; postgres-js names it `constraint_name`.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (
    let current: unknown = error;
    current instanceof Error;
    current = current.cause
  ) {
    if (
      Reflect.get(current, "code") === UNIQUE_VIOLATION &&
      (Reflect.get(current, "constraint") ??
        Reflect.get(current, "constraint_name")) === constraint
    ) {
      return true;
    }
  }
  return false;
}

export type UniqueCodeOptions = {
  format: CodeFormat;
  /** The unique constraint that guards the code column. */
  constraint: string;
  random?: RandomBytes;
  /** How many codes to try before giving up. Defaults to 5. */
  maxAttempts?: number;
};

/**
 * Runs `attempt` with a new random code until it stores one that isn't
 * taken. A duplicate on `constraint` draws another code; any other failure
 * is rethrown at once.
 *
 * In a transaction, a failed statement aborts it, so run each attempt in
 * a savepoint (`tx.transaction(...)`) for the retry to work.
 */
export async function withUniqueCode<T>(
  { format, constraint, random, maxAttempts = 5 }: UniqueCodeOptions,
  attempt: (code: string) => Promise<T>
): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await attempt(generateCode(format, random));
    } catch (error) {
      if (!isUniqueViolation(error, constraint)) throw error;
      if (tries >= maxAttempts) {
        throw new UniqueCodeExhaustedError(format, tries);
      }
    }
  }
}
