import { describe, expect, it } from "vitest";

import { createBlindIndex, parseBlindIndexKey } from "./blind-index";
import { createFieldCipher, parseKeyRing } from "./field-cipher";
import { fieldCryptoFor } from "./keys";

const KEYS = "1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const HMAC = "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=";

describe("fieldCryptoFor", () => {
  it("uses the configured keys", () => {
    const { cipher, blindIndex } = fieldCryptoFor({
      APP_ENV: "production",
      FIELD_ENCRYPTION_KEYS: KEYS,
      FIELD_HMAC_KEY: HMAC,
    });

    const expected = createBlindIndex(parseBlindIndexKey(HMAC));
    expect(blindIndex.of("user.phone", "+919876543210")).toBe(
      expected.of("user.phone", "+919876543210")
    );
    const stored = createFieldCipher(parseKeyRing(KEYS)).encrypt(
      "user.phone",
      "+919876543210"
    );
    expect(cipher.decrypt("user.phone", stored)).toBe("+919876543210");
  });

  it("gives a local run and a preview the same development keys", () => {
    // The seed and the app read the keys separately: a phone the seed
    // stores must be found and read by the app on the same preview.
    const local = fieldCryptoFor({ APP_ENV: "local" });
    const preview = fieldCryptoFor({ APP_ENV: "preview" });

    expect(local.blindIndex.of("user.phone", "+919000000101")).toBe(
      preview.blindIndex.of("user.phone", "+919000000101")
    );
    const stored = local.cipher.encrypt("user.phone", "+919000000101");
    expect(preview.cipher.decrypt("user.phone", stored)).toBe("+919000000101");
  });

  it.each(["staging", "production"] as const)(
    "never falls back to the development keys on %s",
    (APP_ENV) => {
      expect(() => fieldCryptoFor({ APP_ENV })).toThrow(
        /FIELD_ENCRYPTION_KEYS and FIELD_HMAC_KEY/
      );
      expect(() =>
        fieldCryptoFor({ APP_ENV, FIELD_ENCRYPTION_KEYS: KEYS })
      ).toThrow(/FIELD_HMAC_KEY/);
    }
  );
});
