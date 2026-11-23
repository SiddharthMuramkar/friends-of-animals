import { describe, expect, it } from "vitest";

import { isReportReference, reportReferenceFormat } from "./reference";

describe("reportReferenceFormat", () => {
  it("prefixes the two-digit year the report was filed in", () => {
    expect(reportReferenceFormat(new Date("2027-06-01T00:00:00.000Z"))).toEqual(
      { prefix: "SG-27-", length: 6 }
    );
  });

  it("uses India's new year, not UTC's", () => {
    // 31 Dec 2026, 18:30 UTC is already 1 Jan 2027, 00:00 IST.
    expect(
      reportReferenceFormat(new Date("2026-12-31T18:30:00.000Z")).prefix
    ).toBe("SG-27-");
    expect(
      reportReferenceFormat(new Date("2026-12-31T18:29:59.999Z")).prefix
    ).toBe("SG-26-");
  });
});

describe("isReportReference", () => {
  it("accepts a reference typed in any case, with spaces around it", () => {
    expect(isReportReference("SG-27-8H3TZQ")).toBe(true);
    expect(isReportReference(" sg-27-8h3tzq ")).toBe(true);
  });

  it("rejects other prefixes, lengths and non-Crockford symbols", () => {
    for (const text of [
      "PR-27-8H3TZQ",
      "SG-2027-8H3TZQ",
      "SG-27-8H3TZ",
      "SG-27-8H3TZQQ",
      "SG-27-8H3TZI",
      "SG-27-8H3TZO",
      "SG-27-8H3TZU",
      "SG278H3TZQ",
      "",
    ]) {
      expect(isReportReference(text), text).toBe(false);
    }
  });
});
