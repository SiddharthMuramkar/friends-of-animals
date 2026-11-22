import { describe, expect, it } from "vitest";

import { TEST_AUTH } from "@/test/harness";

import { openTotpSecret, sealTotpSecret } from "./secret-box";

const { secret: authSecret } = TEST_AUTH;
const FACTOR_ID = "01960000-0000-7000-8000-000000000001";
const SECRET = new Uint8Array(20).map((_, index) => index);

describe("sealTotpSecret and openTotpSecret", () => {
  it("opens what it sealed, for the same factor only", () => {
    const sealed = sealTotpSecret(authSecret, FACTOR_ID, SECRET);

    expect(openTotpSecret(authSecret, FACTOR_ID, sealed)).toEqual(SECRET);
    expect(() =>
      openTotpSecret(authSecret, "01960000-0000-7000-8000-000000000002", sealed)
    ).toThrow();
  });

  it("refuses a sealed value whose tag was cut short", () => {
    const [version, iv, ciphertext, tag] = sealTotpSecret(
      authSecret,
      FACTOR_ID,
      SECRET
    ).split(".");
    const shortTag = Buffer.from(tag ?? "", "base64url")
      .subarray(0, 4)
      .toString("base64url");

    expect(() =>
      openTotpSecret(
        authSecret,
        FACTOR_ID,
        [version, iv, ciphertext, shortTag].join(".")
      )
    ).toThrow();
  });
});
