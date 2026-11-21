import { describe, expect, it } from "vitest";

import { participantCode } from "./participant-code";

const FORMAT = /^FOA-P-\d{2}[0-9A-HJKMNP-TV-Z]{6}$/;

describe("participantCode", () => {
  it("is FOA-P-, the two-digit year it was issued, then the six symbols", () => {
    const code = participantCode(
      new Date("2027-01-15T04:30:00.000Z"),
      "7K3M9Q"
    );
    expect(code).toBe("FOA-P-277K3M9Q");
    expect(code).toMatch(FORMAT);
  });

  it("takes the year from India's calendar, which turns 5½ hours before UTC's", () => {
    // 23:59 IST on 31 December 2026, then 00:00 IST on 1 January 2027.
    expect(
      participantCode(new Date("2026-12-31T18:29:59.999Z"), "000000")
    ).toBe("FOA-P-26000000");
    expect(
      participantCode(new Date("2026-12-31T18:30:00.000Z"), "000000")
    ).toBe("FOA-P-27000000");
  });

  it("keeps a leading zero in the year", () => {
    expect(
      participantCode(new Date("2105-06-01T00:00:00.000Z"), "ABCDEF")
    ).toBe("FOA-P-05ABCDEF");
  });

  it("refuses symbols that are not six Crockford base32 characters", () => {
    const at = new Date("2027-01-15T04:30:00.000Z");
    // I, L, O and U are left out so codes read back without mix-ups.
    for (const symbols of ["7K3M9", "7K3M9QX", "7K3M9I", "LOU000", "7k3m9q"])
      expect(() => participantCode(at, symbols)).toThrow(RangeError);
  });
});
