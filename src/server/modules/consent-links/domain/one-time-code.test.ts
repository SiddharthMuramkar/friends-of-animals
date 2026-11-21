import { describe, expect, it } from "vitest";

import {
  CODE_DIGITS,
  createOneTimeCode,
  hashOneTimeCode,
  normaliseOneTimeCode,
  oneTimeCodeMatches,
  type RandomWords,
} from "./one-time-code";

const LINK_ID = "01890a5d-ac96-7e4b-8f3a-3f2a1b0c9d8e";

/** Hands out `words` in order, four at a time as the code asks. */
function words(...values: number[]): RandomWords {
  let next = 0;
  return (count) =>
    Uint32Array.from({ length: count }, () => values[next++] ?? 0);
}

describe("createOneTimeCode", () => {
  it("makes six digits and keeps leading zeros", () => {
    expect(CODE_DIGITS).toBe(6);
    expect(createOneTimeCode(words(42))).toBe("000042");
    expect(createOneTimeCode(words(1_234_567))).toBe("234567");
  });

  it("draws again rather than favour low codes", () => {
    const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
    expect(createOneTimeCode(words(limit, 2 ** 32 - 1, 7))).toBe("000007");
  });

  it("uses the system's randomness by default", () => {
    expect(createOneTimeCode()).toMatch(/^\d{6}$/);
  });
});

describe("normaliseOneTimeCode", () => {
  it("takes out spaces a guardian may type or paste", () => {
    expect(normaliseOneTimeCode(" 123 456 ")).toBe("123456");
  });

  it("refuses anything but six digits", () => {
    for (const value of ["12345", "1234567", "12a456", "", "١٢٣٤٥٦"]) {
      expect(normaliseOneTimeCode(value)).toBeNull();
    }
  });
});

describe("oneTimeCodeMatches", () => {
  const stored = hashOneTimeCode(LINK_ID, "042917");

  it("matches the stored code, typed with spaces or not", () => {
    expect(oneTimeCodeMatches(LINK_ID, "042917", stored)).toBe(true);
    expect(oneTimeCodeMatches(LINK_ID, "042 917", stored)).toBe(true);
  });

  it("refuses another code, another link's code or no code", () => {
    expect(oneTimeCodeMatches(LINK_ID, "042918", stored)).toBe(false);
    expect(
      oneTimeCodeMatches(
        "01890a5d-ac96-7e4b-8f3a-000000000000",
        "042917",
        stored
      )
    ).toBe(false);
    expect(oneTimeCodeMatches(LINK_ID, "042917", null)).toBe(false);
    expect(oneTimeCodeMatches(LINK_ID, "abc", stored)).toBe(false);
  });

  it("stores a hash, never the code", () => {
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain("042917");
  });
});
