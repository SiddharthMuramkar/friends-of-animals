import { describe, expect, it } from "vitest";

import {
  CERTIFICATE_NUMBER as SAMPLE_PATTERN,
  SAMPLE_CERTIFICATE,
} from "@/content/sample/certificate";

import {
  CERTIFICATE_NUMBER_PATTERN,
  certificateNumberFormat,
  isCertificateNumber,
  normaliseCertificateNumber,
  verifyPathFor,
} from "./number";

describe("certificate number format", () => {
  it("is the pattern the public site's sample certificate uses", () => {
    expect(CERTIFICATE_NUMBER_PATTERN.source).toBe(SAMPLE_PATTERN.source);
    expect(isCertificateNumber(SAMPLE_CERTIFICATE.number)).toBe(true);
  });

  it("prefixes ten symbols with the two-digit year of issue", () => {
    expect(certificateNumberFormat(new Date("2027-03-15T06:00:00Z"))).toEqual({
      prefix: "FOA-C-27-",
      length: 10,
    });
  });

  it("takes the year from India's calendar, not UTC's", () => {
    // 31 Dec 2027 18:30 UTC is already 1 Jan 2028 00:00 in India.
    expect(
      certificateNumberFormat(new Date("2027-12-31T18:29:59Z")).prefix
    ).toBe("FOA-C-27-");
    expect(
      certificateNumberFormat(new Date("2027-12-31T18:30:00Z")).prefix
    ).toBe("FOA-C-28-");
  });

  it("keeps two digits for years ending in 00 to 09", () => {
    expect(
      certificateNumberFormat(new Date("2105-06-01T00:00:00Z")).prefix
    ).toBe("FOA-C-05-");
  });

  it.each([
    "FOA-C-27-9XQ4M2T7KD",
    "FOA-C-00-0000000000",
    "FOA-C-99-ZZZZZZZZZZ",
  ])("accepts %s", (number) => {
    expect(isCertificateNumber(number)).toBe(true);
  });

  it.each([
    ["an I", "FOA-C-27-9XQ4M2T7KI"],
    ["an L", "FOA-C-27-9XQ4M2T7KL"],
    ["an O", "FOA-C-27-9XQ4M2T7KO"],
    ["a U", "FOA-C-27-9XQ4M2T7KU"],
    ["lower case", "foa-c-27-9xq4m2t7kd"],
    ["nine symbols", "FOA-C-27-9XQ4M2T7K"],
    ["eleven symbols", "FOA-C-27-9XQ4M2T7KDD"],
    ["a three-digit year", "FOA-C-207-9XQ4M2T7KD"],
    ["another prefix", "FOA-P-27-9XQ4M2T7KD"],
    ["surrounding space", " FOA-C-27-9XQ4M2T7KD"],
  ])("rejects a number with %s", (_, number) => {
    expect(isCertificateNumber(number)).toBe(false);
  });
});

describe("normaliseCertificateNumber", () => {
  it.each([
    ["the exact number", "FOA-C-27-9XQ4M2T7KD"],
    ["lower case", "foa-c-27-9xq4m2t7kd"],
    ["surrounding spaces", "  FOA-C-27-9XQ4M2T7KD \n"],
    ["spaces inside", "FOA-C-27 9XQ4 M2T7 KD"],
    ["no hyphens", "FOAC279XQ4M2T7KD"],
  ])("reads %s as the stored form", (_, input) => {
    expect(normaliseCertificateNumber(input)).toBe("FOA-C-27-9XQ4M2T7KD");
  });

  it("reads O as 0 and I or L as 1 in the year and the code", () => {
    expect(normaliseCertificateNumber("FOA-C-2O-1OIL000000")).toBe(
      "FOA-C-20-1011000000"
    );
    expect(normaliseCertificateNumber("foa-c-l7-oooooooooo")).toBe(
      "FOA-C-17-0000000000"
    );
  });

  it.each([
    ["an empty string", ""],
    ["only spaces", "   "],
    ["a U in the code", "FOA-C-27-9XQ4M2T7KU"],
    ["a letter in the year", "FOA-C-2A-9XQ4M2T7KD"],
    ["nine symbols", "FOA-C-27-9XQ4M2T7K"],
    ["eleven symbols", "FOA-C-27-9XQ4M2T7KDD"],
    ["another code's prefix", "FOA-P-27-9XQ4M2T7KD"],
    ["punctuation", "FOA-C-27-9XQ4M2T7K!"],
    ["a path", "../../etc/passwd"],
  ])("returns null for %s", (_, input) => {
    expect(normaliseCertificateNumber(input)).toBeNull();
  });

  it("returns null for input far longer than any number", () => {
    expect(
      normaliseCertificateNumber("FOA-C-27-" + "0".repeat(500))
    ).toBeNull();
  });

  it("always returns a valid number or null", () => {
    for (const input of ["foac27oooooooooo", "FOA C 27 ILILILILIL", "x"]) {
      const result = normaliseCertificateNumber(input);
      expect(result === null || isCertificateNumber(result)).toBe(true);
    }
  });
});

describe("verifyPathFor", () => {
  it("is the public verification page for the number", () => {
    expect(verifyPathFor("FOA-C-27-9XQ4M2T7KD")).toBe(
      "/verify/FOA-C-27-9XQ4M2T7KD"
    );
  });

  it("refuses anything that is not a stored-form number", () => {
    expect(() => verifyPathFor("foa-c-27-9xq4m2t7kd")).toThrow(RangeError);
  });
});
