import { describe, expect, it } from "vitest";

import {
  isReportReference,
  newReportReference,
  reportReferenceFormat,
} from "./reference";

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

describe("newReportReference", () => {
  it("draws six Crockford symbols after the filing year's prefix", () => {
    // 0, 9, 10 and 31 are the first and last digits and letters; 32 and
    // 255 wrap round to 0 and 31.
    const bytes = new Uint8Array([0, 9, 10, 31, 32, 255]);

    const reference = newReportReference(
      new Date("2027-06-01T00:00:00.000Z"),
      () => bytes
    );

    expect(reference).toBe("SG-27-09AZ0Z");
    expect(isReportReference(reference)).toBe(true);
  });

  it("gives a fresh reference each time by default", () => {
    const at = new Date("2027-06-01T00:00:00.000Z");
    const references = new Set(
      Array.from({ length: 20 }, () => newReportReference(at))
    );

    expect(references.size).toBe(20);
    for (const reference of references) {
      expect(isReportReference(reference)).toBe(true);
    }
  });
});
