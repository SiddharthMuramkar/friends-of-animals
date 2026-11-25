import { describe, expect, it } from "vitest";

import { LOT_CODE_PATTERN, lotCodeFormat, parseLotCode } from "./lot-code";

describe("the lot code format", () => {
  it("is LOT-, the two-digit year in IST, a dash and five symbols", () => {
    expect(lotCodeFormat(new Date("2027-01-15T04:30:00.000Z"))).toEqual({
      prefix: "LOT-27-",
      length: 5,
    });
  });

  it("takes the year in IST, which starts 5 h 30 min before UTC's", () => {
    // 23:59 on 31 December 2027 in IST.
    expect(lotCodeFormat(new Date("2027-12-31T18:29:59.999Z")).prefix).toBe(
      "LOT-27-"
    );
    // 00:00 on 1 January 2028 in IST, still 31 December in UTC.
    expect(lotCodeFormat(new Date("2027-12-31T18:30:00.000Z")).prefix).toBe(
      "LOT-28-"
    );
  });

  it("keeps the leading zero of years like 2030 → 30 and 2105 → 05", () => {
    expect(lotCodeFormat(new Date("2030-06-01T00:00:00.000Z")).prefix).toBe(
      "LOT-30-"
    );
    expect(lotCodeFormat(new Date("2105-06-01T00:00:00.000Z")).prefix).toBe(
      "LOT-05-"
    );
  });

  it("refuses an invalid date", () => {
    expect(() => lotCodeFormat(new Date("not a date"))).toThrow(RangeError);
  });
});

describe("LOT_CODE_PATTERN", () => {
  it.each(["LOT-27-8H3TZ", "LOT-05-00000", "LOT-99-ZZZZZ"])(
    "accepts %s",
    (code) => {
      expect(LOT_CODE_PATTERN.test(code)).toBe(true);
    }
  );

  it.each([
    ["a letter Crockford leaves out (I)", "LOT-27-8H3TI"],
    ["a letter Crockford leaves out (L)", "LOT-27-L0000"],
    ["a letter Crockford leaves out (O)", "LOT-27-O0000"],
    ["a letter Crockford leaves out (U)", "LOT-27-U0000"],
    ["lower case", "lot-27-8h3tz"],
    ["four symbols", "LOT-27-8H3T"],
    ["six symbols", "LOT-27-8H3TZA"],
    ["a three-digit year", "LOT-027-8H3TZ"],
    ["another prefix", "FOA-I-8H3TZ"],
    ["surrounding spaces", " LOT-27-8H3TZ "],
  ])("refuses %s", (_, code) => {
    expect(LOT_CODE_PATTERN.test(code)).toBe(false);
  });
});

describe("parseLotCode", () => {
  it("returns a well-formed code as it is", () => {
    expect(parseLotCode("LOT-27-8H3TZ")).toBe("LOT-27-8H3TZ");
  });

  it("trims and upper-cases what a person typed or a link carried", () => {
    expect(parseLotCode("  lot-27-8h3tz\n")).toBe("LOT-27-8H3TZ");
  });

  it.each(["", "LOT-27-8H3TI", "LOT-27-8H3T", "../LOT-27-8H3TZ", "LOT-27"])(
    "returns null for %j",
    (raw) => {
      expect(parseLotCode(raw)).toBeNull();
    }
  );
});
