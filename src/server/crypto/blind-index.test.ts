import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  BlindIndexError,
  createBlindIndex,
  parseBlindIndexKey,
} from "./blind-index";

const freshKey = () => parseBlindIndexKey(randomBytes(32).toString("base64"));

describe("createBlindIndex()", () => {
  it("gives one number the same index every time, so sign-in can find it", () => {
    const index = createBlindIndex(freshKey());

    expect(index.of("user.phone", "+919876543210")).toBe(
      index.of("user.phone", "+919876543210")
    );
    expect(index.of("user.phone", "+919876543210")).not.toBe(
      index.of("user.phone", "+919876543211")
    );
  });

  it("keeps the same derivation, so indexes already stored keep matching", () => {
    // Expected values from `openssl dgst -sha256 -mac HMAC` over
    // "<purpose>\0<value>" with the key bytes 0x00..0x1f.
    const index = createBlindIndex(
      parseBlindIndexKey("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
    );

    expect(index.of("user.phone", "+919876543210")).toBe(
      "06954956379166589981863c6c42d501f22cd06c4b1949659f43a08c4ba1a954"
    );
    expect(index.of("guardian.phone", "+919876543210")).toBe(
      "f86aff601204f0173c55465e53382628c09784cf909febc2797f0ee7657a4ccd"
    );
  });

  it("can't be worked out without the key", () => {
    expect(
      createBlindIndex(freshKey()).of("user.phone", "+919876543210")
    ).not.toBe(createBlindIndex(freshKey()).of("user.phone", "+919876543210"));
  });

  it.each(["", "user\0phone"])("refuses the purpose %j", (purpose) => {
    const index = createBlindIndex(freshKey());

    expect(() => index.of(purpose, "+919876543210")).toThrow(BlindIndexError);
  });
});

describe("parseBlindIndexKey()", () => {
  it.each([
    ["", "nothing"],
    ["c2hvcnQ=", "five bytes"],
    [`${"A".repeat(40)}!!!=`, "characters base64 does not use"],
  ])("refuses %j (%s)", (value) => {
    expect(() => parseBlindIndexKey(value)).toThrow(
      new BlindIndexError(
        "FIELD_HMAC_KEY is not 32 bytes of base64; make one with " +
          "`openssl rand -base64 32`"
      )
    );
  });
});
