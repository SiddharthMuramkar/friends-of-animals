import { describe, expect, it } from "vitest";

import { base32Encode } from "./base32";
import { generateTotpSecret, otpauthUri, totpCode, verifyTotp } from "./totp";

// The shared secret of RFC 4226 appendix D and RFC 6238 appendix B.
const SECRET = new TextEncoder().encode("12345678901234567890");
const atSecond = (seconds: number) => new Date(seconds * 1000);

describe("totpCode", () => {
  // RFC 4226 appendix D: HOTP values for counters 0-9. TOTP's counter is
  // the 30-second step, so step n starts at n * 30 s.
  it.each([
    [0, "755224"],
    [1, "287082"],
    [2, "359152"],
    [3, "969429"],
    [4, "338314"],
    [5, "254676"],
    [6, "287922"],
    [7, "162583"],
    [8, "399871"],
    [9, "520489"],
  ])("gives the RFC 4226 code for step %i", (step, code) => {
    expect(totpCode(SECRET, atSecond(step * 30))).toBe(code);
  });

  // RFC 6238 appendix B (SHA-1), last six of the eight published digits.
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("gives the RFC 6238 code at Unix time %i", (seconds, code) => {
    expect(totpCode(SECRET, atSecond(seconds))).toBe(code);
  });
});

describe("verifyTotp", () => {
  const now = atSecond(1234567890); // step 41152263
  const step = 41152263;

  it("accepts the current code and reports its step", () => {
    expect(
      verifyTotp({
        secret: SECRET,
        code: "005924",
        at: now,
        lastUsedStep: null,
      })
    ).toEqual({ ok: true, step });
  });

  it("accepts a code one step early or late, for phone clock drift", () => {
    const previous = totpCode(SECRET, atSecond(1234567890 - 30));
    const next = totpCode(SECRET, atSecond(1234567890 + 30));
    expect(
      verifyTotp({
        secret: SECRET,
        code: previous,
        at: now,
        lastUsedStep: null,
      })
    ).toEqual({ ok: true, step: step - 1 });
    expect(
      verifyTotp({ secret: SECRET, code: next, at: now, lastUsedStep: null })
    ).toEqual({ ok: true, step: step + 1 });
  });

  it("refuses a code two steps old", () => {
    const stale = totpCode(SECRET, atSecond(1234567890 - 60));
    expect(
      verifyTotp({ secret: SECRET, code: stale, at: now, lastUsedStep: null })
    ).toEqual({ ok: false, reason: "wrong_code" });
  });

  it("refuses a code for another secret", () => {
    const other = new TextEncoder().encode("abcdefghijabcdefghij");
    expect(
      verifyTotp({
        secret: other,
        code: "005924",
        at: now,
        lastUsedStep: null,
      })
    ).toEqual({ ok: false, reason: "wrong_code" });
  });

  it("refuses a code used once already, and any earlier one", () => {
    expect(
      verifyTotp({
        secret: SECRET,
        code: "005924",
        at: now,
        lastUsedStep: step,
      })
    ).toEqual({ ok: false, reason: "reused" });
    const previous = totpCode(SECRET, atSecond(1234567890 - 30));
    expect(
      verifyTotp({
        secret: SECRET,
        code: previous,
        at: now,
        lastUsedStep: step,
      })
    ).toEqual({ ok: false, reason: "reused" });
  });

  it("accepts a later step after an earlier one was used", () => {
    const next = totpCode(SECRET, atSecond(1234567890 + 30));
    expect(
      verifyTotp({ secret: SECRET, code: next, at: now, lastUsedStep: step })
    ).toEqual({ ok: true, step: step + 1 });
  });

  it("accepts the code with the space apps show in the middle", () => {
    expect(
      verifyTotp({
        secret: SECRET,
        code: " 005 924 ",
        at: now,
        lastUsedStep: null,
      })
    ).toEqual({ ok: true, step });
  });

  it.each(["", "00592", "0059245", "abcdef", "00592x"])(
    "calls %j malformed without checking it",
    (code) => {
      expect(
        verifyTotp({ secret: SECRET, code, at: now, lastUsedStep: null })
      ).toEqual({ ok: false, reason: "malformed" });
    }
  );
});

describe("generateTotpSecret", () => {
  it("makes a 160-bit secret from the random source", () => {
    const fixed = Uint8Array.from({ length: 20 }, (_, index) => index);
    expect(generateTotpSecret(() => fixed)).toEqual(fixed);
  });

  it("uses fresh randomness by default", () => {
    const first = generateTotpSecret();
    expect(first).toHaveLength(20);
    expect(generateTotpSecret()).not.toEqual(first);
  });
});

describe("otpauthUri", () => {
  it("builds the link an authenticator app reads from the QR code", () => {
    expect(
      otpauthUri({
        issuer: "Friends of Animals",
        account: "asha@example.test",
        secret: SECRET,
      })
    ).toBe(
      "otpauth://totp/Friends%20of%20Animals:asha%40example.test" +
        `?secret=${base32Encode(SECRET)}` +
        "&issuer=Friends%20of%20Animals&algorithm=SHA1&digits=6&period=30"
    );
  });
});
