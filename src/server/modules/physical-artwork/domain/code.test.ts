import { describe, expect, it } from "vitest";

import {
  ARTWORK_CODE_PATTERN,
  artworkCodeFormat,
  normaliseArtworkCode,
} from "./code";

describe("artworkCodeFormat", () => {
  it("puts the competition code and -A- before six symbols", () => {
    expect(artworkCodeFormat("PAWS26")).toEqual({
      prefix: "PAWS26-A-",
      length: 6,
    });
    expect(artworkCodeFormat("ART27")).toEqual({
      prefix: "ART27-A-",
      length: 6,
    });
  });

  it.each(["", "paws26", "PAWS2", "AB26", "PAWSOME26", "PAWS-26", " PAWS26"])(
    "refuses the competition code %j",
    (competitionCode) => {
      expect(() => artworkCodeFormat(competitionCode)).toThrow(RangeError);
    }
  );
});

describe("ARTWORK_CODE_PATTERN", () => {
  it.each(["PAWS26-A-8H3TZ0", "ART27-A-000000", "LIONS27-A-ZZZZZZ"])(
    "matches %s",
    (code) => {
      expect(ARTWORK_CODE_PATTERN.test(code)).toBe(true);
    }
  );

  it.each([
    "PAWS26-A-8H3TZ", // five symbols
    "PAWS26-A-8H3TZ00", // seven symbols
    "PAWS26-E-8H3TZ0", // an Entry ID
    "PAWS26-A-8H3TZI", // I is not Crockford
    "PAWS26-A-8H3TZU", // nor is U
    "paws26-a-8h3tz0", // stored upper case
    "PAWS26-A-8H3TZ0 ",
  ])("does not match %j", (code) => {
    expect(ARTWORK_CODE_PATTERN.test(code)).toBe(false);
  });
});

describe("normaliseArtworkCode", () => {
  it("returns a stored code unchanged", () => {
    expect(normaliseArtworkCode("PAWS26-A-8H3TZ0")).toBe("PAWS26-A-8H3TZ0");
  });

  it("accepts what staff type: lower case, spaces, a trailing newline", () => {
    expect(normaliseArtworkCode("  paws26-a-8h3tz0\n")).toBe("PAWS26-A-8H3TZ0");
    expect(normaliseArtworkCode("PAWS26 - A - 8H3 TZ0")).toBe(
      "PAWS26-A-8H3TZ0"
    );
  });

  it("reads I and L as 1 and O as 0 in the six symbols, as Crockford does", () => {
    expect(normaliseArtworkCode("PAWS26-A-IL0O00")).toBe("PAWS26-A-110000");
    expect(normaliseArtworkCode("paws26-a-o1i2l3")).toBe("PAWS26-A-011213");
  });

  it("keeps I, L and O in the competition code, where they are letters", () => {
    expect(normaliseArtworkCode("lion27-a-8h3tz0")).toBe("LION27-A-8H3TZ0");
  });

  it.each([
    "",
    "   ",
    "PAWS26-A-8H3TZ", // too short
    "PAWS26-A-8H3TZU", // U never appears
    "PAWS26-E-8H3TZ0", // an Entry ID
    "8H3TZ0",
    "PAWS26-A-8H3TZ0-A-8H3TZ0",
    "PAWS26–A–8H3TZ0", // en dashes
  ])("returns null for %j", (input) => {
    expect(normaliseArtworkCode(input)).toBeNull();
  });
});
