import { describe, expect, it } from "vitest";

import { isRequestReference, requestReferenceFormat } from "./reference";

describe("requestReferenceFormat", () => {
  it("prefixes the two-digit year the request was filed in, in IST", () => {
    expect(
      requestReferenceFormat(new Date("2027-06-01T00:00:00.000Z"))
    ).toEqual({ prefix: "PR-27-", length: 6 });
  });

  it("uses India's new year, not UTC's", () => {
    // 31 Dec 2026, 18:30 UTC is already 1 Jan 2027, 00:00 IST.
    expect(
      requestReferenceFormat(new Date("2026-12-31T18:30:00.000Z")).prefix
    ).toBe("PR-27-");
    expect(
      requestReferenceFormat(new Date("2026-12-31T18:29:59.999Z")).prefix
    ).toBe("PR-26-");
  });
});

describe("isRequestReference", () => {
  it("accepts a reference typed in any case, with spaces around it", () => {
    expect(isRequestReference("PR-27-8H3TZQ")).toBe(true);
    expect(isRequestReference(" pr-27-8h3tzq ")).toBe(true);
  });

  it("rejects anything outside the format or the Crockford symbols", () => {
    for (const text of [
      "PR-27-8H3TZ",
      "PR-27-8H3TZQX",
      "PR-2027-8H3TZQ",
      "PR-27-8H3TZU",
      "PR-27-8I3TZQ",
      "FOA-I-8H3TZ",
      "",
    ]) {
      expect(isRequestReference(text)).toBe(false);
    }
  });
});
