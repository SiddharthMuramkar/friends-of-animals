import { describe, expect, it } from "vitest";

import {
  formatInstitutionRegistrationReference,
  INSTITUTION_REFERENCE_PATTERN,
  parseInstitutionRegistrationReference,
  REFERENCE_SYMBOL_COUNT,
} from "./institution-registration-reference";

describe("formatInstitutionRegistrationReference", () => {
  it("joins the competition code, I and the symbols", () => {
    expect(formatInstitutionRegistrationReference("PAWS26", "Q2W9R")).toBe(
      "PAWS26-I-Q2W9R"
    );
  });

  it("uses five symbols", () => {
    expect(REFERENCE_SYMBOL_COUNT).toBe(5);
  });

  it("makes references the pattern accepts", () => {
    const reference = formatInstitutionRegistrationReference(
      "NEIGH27",
      "0Z9AB"
    );
    expect(reference).toMatch(INSTITUTION_REFERENCE_PATTERN);
  });

  it.each(["paws26", "PA26", "PAWSOME26", "PAWS2026", ""])(
    "refuses the competition code %j",
    (code) => {
      expect(() =>
        formatInstitutionRegistrationReference(code, "Q2W9R")
      ).toThrow(RangeError);
    }
  );

  it.each(["Q2W9", "Q2W9RX", "Q2W9I", "Q2W9L", "Q2W9O", "Q2W9U", "q2w9r"])(
    "refuses the symbols %j",
    (symbols) => {
      expect(() =>
        formatInstitutionRegistrationReference("PAWS26", symbols)
      ).toThrow(RangeError);
    }
  );
});

describe("parseInstitutionRegistrationReference", () => {
  it("reads a reference back into its parts", () => {
    expect(parseInstitutionRegistrationReference("PAWS26-I-Q2W9R")).toEqual({
      reference: "PAWS26-I-Q2W9R",
      competitionCode: "PAWS26",
      symbols: "Q2W9R",
    });
  });

  it("tolerates case and surrounding spaces", () => {
    expect(
      parseInstitutionRegistrationReference("  paws26-i-q2w9r ")?.reference
    ).toBe("PAWS26-I-Q2W9R");
  });

  it("reads look-alike letters in the symbols as Crockford digits", () => {
    expect(
      parseInstitutionRegistrationReference("PAWS26-I-OILQ2")?.reference
    ).toBe("PAWS26-I-011Q2");
  });

  it.each([
    "PAWS26-R-Q2W9R",
    "PAWS26-I-Q2W9",
    "PAWS26-I-Q2W9RR",
    "PAWS26-I-Q2W9U",
    "PAWS26I-Q2W9R",
    "P26-I-Q2W9R",
    "",
  ])("refuses %j", (text) => {
    expect(parseInstitutionRegistrationReference(text)).toBeNull();
  });
});
