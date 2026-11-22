import { describe, expect, it } from "vitest";

import {
  createLinkToken,
  hashLinkToken,
  isWellFormedLinkToken,
  LINK_TOKEN_BYTES,
} from "./link-token";

// Bytes 0x00..0x1f, whose base64url form is a well-known value.
const counting = (size: number) =>
  Uint8Array.from({ length: size }, (_, i) => i);
const COUNTING_TOKEN = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

describe("createLinkToken", () => {
  it("encodes 32 random bytes as 43 base64url characters", () => {
    expect(LINK_TOKEN_BYTES).toBe(32);
    expect(createLinkToken(counting).token).toBe(COUNTING_TOKEN);
  });

  it("asks the random source for 32 bytes", () => {
    const sizes: number[] = [];
    createLinkToken((size) => {
      sizes.push(size);
      return new Uint8Array(size);
    });
    expect(sizes).toEqual([32]);
  });

  it("returns the hash to store with the token to send", () => {
    expect(createLinkToken(counting).tokenHash).toBe(
      "ea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0"
    );
  });

  it("gives a new token each time by default", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => createLinkToken().token)
    );
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(isWellFormedLinkToken(token)).toBe(true);
  });

  it("refuses a random source that returns too few bytes", () => {
    expect(() => createLinkToken(() => new Uint8Array(16))).toThrow(RangeError);
  });
});

describe("hashLinkToken", () => {
  it("is the SHA-256 of the token in lower-case hex", () => {
    expect(hashLinkToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(hashLinkToken(COUNTING_TOKEN)).toBe(
      createLinkToken(counting).tokenHash
    );
  });
});

describe("isWellFormedLinkToken", () => {
  it("accepts exactly 43 base64url characters", () => {
    expect(isWellFormedLinkToken(COUNTING_TOKEN)).toBe(true);
    expect(isWellFormedLinkToken("-_" + "a".repeat(41))).toBe(true);
  });

  it("refuses anything else before it reaches the database", () => {
    for (const value of [
      "",
      COUNTING_TOKEN.slice(1),
      COUNTING_TOKEN + "A",
      COUNTING_TOKEN + "=",
      "+" + COUNTING_TOKEN.slice(1),
      "/" + COUNTING_TOKEN.slice(1),
      " " + COUNTING_TOKEN.slice(1),
      COUNTING_TOKEN.slice(1) + "\n",
    ]) {
      expect(isWellFormedLinkToken(value)).toBe(false);
    }
  });
});
