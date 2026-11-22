// Base32 (RFC 4648, section 6): how authenticator apps exchange TOTP
// secrets, in the otpauth:// link inside the QR code and as the key a person
// types by hand. Pure, no I/O.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encodes `bytes` in upper case, without `=` padding (as apps expect). */
export function base32Encode(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += ALPHABET[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) output += ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

/**
 * Decodes a base32 string. Accepts what a person may type from a screen:
 * any case, spaces, and trailing `=` padding. Throws on other characters.
 */
export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s=]+/g, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) {
      throw new SyntaxError(`Not a base32 character: ${JSON.stringify(char)}`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  return Uint8Array.from(bytes);
}
