// Internal ids are UUIDv7 (RFC 9562), made in the app from the injected
// clock: PGlite, which the tests run on, has no uuidv7() function, and a
// time-ordered id keeps index inserts local. Human-facing codes are separate.
//
// Loads under plain Node (seed script), so no "server-only" here.

/** Fills 10 bytes with randomness; tests may pass a fixed source. */
type RandomBytes = () => Uint8Array;

const cryptoRandom: RandomBytes = () =>
  crypto.getRandomValues(new Uint8Array(10));

/** A new UUIDv7 whose first 48 bits are `at` in Unix milliseconds. */
export function uuidv7(at: Date, random: RandomBytes = cryptoRandom): string {
  const bytes = new Uint8Array(16);
  const ms = at.getTime();
  // 48-bit big-endian timestamp. Bitwise operators work on 32 bits, so the
  // top 16 bits are split off by division.
  const high = Math.floor(ms / 2 ** 32);
  const low = ms >>> 0;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
  bytes.set(random().subarray(0, 10), 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f); // version 7
  bytes[8] = 0x80 | (bytes[8]! & 0x3f); // variant 10
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
