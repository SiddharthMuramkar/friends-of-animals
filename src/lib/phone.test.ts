import { describe, expect, it } from "vitest";

import { formatPhoneNumber, parsePhoneNumber, type E164Phone } from "./phone";

describe("parsePhoneNumber()", () => {
  it("reads a 10-digit Indian mobile number as +91 in E.164", () => {
    expect(parsePhoneNumber("9876543210")).toEqual({
      ok: true,
      e164: "+919876543210",
    });
  });

  it.each([
    "+91 98765 43210",
    "+919876543210",
    "+91-98765-43210",
    "919876543210",
    "09876543210",
    "0091 98765 43210",
    "(+91) 98765.43210",
    "  98765 43210  ",
  ])("reads %j as the same number", (written) => {
    expect(parsePhoneNumber(written)).toEqual({
      ok: true,
      e164: "+919876543210",
    });
  });

  it.each([
    ["", "nothing typed"],
    ["98765 4321", "nine digits"],
    ["98765 432109", "eleven digits"],
    ["5876543210", "an Indian number that is not a mobile"],
    ["022 2345 6789", "a landline"],
    ["98765 4321O", "a letter O for a zero"],
    ["+91 98765 43210 ext 2", "extra words"],
    ["9876543210+", "a stray plus"],
    ["+", "a lone plus"],
    ["९८७६५४३२१०", "Devanagari digits"],
    ["9".repeat(5000), "a very long string"],
  ])("refuses %j (%s)", (written) => {
    expect(parsePhoneNumber(written)).toEqual({ ok: false, reason: "invalid" });
  });

  it.each(["+44 20 7946 0958", "+1 202 555 0143", "0044 20 7946 0958"])(
    "says %j is from a country it does not send codes to",
    (written) => {
      expect(parsePhoneNumber(written)).toEqual({
        ok: false,
        reason: "unsupported_country",
      });
    }
  );
});

describe("formatPhoneNumber()", () => {
  it("groups an Indian mobile number the way it is read aloud", () => {
    expect(formatPhoneNumber("+919876543210" as E164Phone)).toBe(
      "+91 98765 43210"
    );
  });
});
