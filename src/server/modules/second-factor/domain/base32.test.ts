import { describe, expect, it } from "vitest";

import { base32Decode, base32Encode } from "./base32";

const ascii = (text: string) => new TextEncoder().encode(text);

describe("base32 (RFC 4648)", () => {
  it.each([
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])("encodes %j as %j without padding", (text, encoded) => {
    expect(base32Encode(ascii(text))).toBe(encoded);
  });

  it("encodes the RFC 6238 test secret the way authenticator apps show it", () => {
    expect(base32Encode(ascii("12345678901234567890"))).toBe(
      "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    );
  });

  it("decodes what it encodes", () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, index) => index * 13);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("accepts a secret typed by hand: lower case, spaces and padding", () => {
    expect(base32Decode("mzxw 6ytb oi======")).toEqual(ascii("foobar"));
  });

  it("refuses characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW1")).toThrow(/base32/i);
    expect(() => base32Decode("MZXW8")).toThrow(/base32/i);
  });
});
