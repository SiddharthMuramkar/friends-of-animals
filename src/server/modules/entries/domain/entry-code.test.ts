import { describe, expect, it } from "vitest";

import { entryCodeFormat, parseEntryCode } from "./entry-code";

describe("entryCodeFormat", () => {
  it("is the competition's code, -E- and six symbols", () => {
    expect(entryCodeFormat("PAWS27")).toEqual({
      prefix: "PAWS27-E-",
      length: 6,
    });
  });

  it.each(["", "PAWS", "paws27", "PAWS2027", "TOOLONG27", "PA27"])(
    "refuses %j, which isn't 3 to 6 capitals and a two-digit year",
    (competitionCode) => {
      expect(() => entryCodeFormat(competitionCode)).toThrow(RangeError);
    }
  );
});

describe("parseEntryCode", () => {
  it("reads an Entry ID as typed, whatever its case and spaces", () => {
    expect(parseEntryCode(" paws27-e-7k3qz9 ")).toBe("PAWS27-E-7K3QZ9");
  });

  it.each([
    "PAWS27-E-7K3QZ",
    "PAWS27-E-7K3QZ90",
    "PAWS27-R-7K3QZ9",
    "PAWS27-E-7K3QZI",
    "PAWS27-E-7K3QZU",
    "FOA-I-8H3TZ",
  ])("refuses %j, which isn't an Entry ID", (code) => {
    expect(parseEntryCode(code)).toBeNull();
  });
});
