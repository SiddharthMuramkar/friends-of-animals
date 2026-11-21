import { describe, expect, it } from "vitest";

import { bundleManifestCsv, MANIFEST_FILE_NAME } from "./bundle-manifest";

const BOM = "﻿";

describe("bundleManifestCsv", () => {
  it("is a UTF-8 CSV with a byte-order mark and CRLF lines", () => {
    expect(MANIFEST_FILE_NAME).toBe("certificates.csv");
    expect(
      bundleManifestCsv(
        ["File", "Number", "Name"],
        [["FOA-C-27-AAAAAAAAAA.pdf", "FOA-C-27-AAAAAAAAAA", "Asha Rao"]]
      )
    ).toBe(
      `${BOM}File,Number,Name\r\nFOA-C-27-AAAAAAAAAA.pdf,FOA-C-27-AAAAAAAAAA,Asha Rao\r\n`
    );
  });

  it("quotes cells with commas, quotes or line breaks", () => {
    expect(
      bundleManifestCsv(
        ["Name", "Award"],
        [
          ['Rao, "Ash"', "First prize\nJunior"],
          ["D'Souza", "Line\r\nbreak"],
        ]
      )
    ).toBe(
      `${BOM}Name,Award\r\n"Rao, ""Ash""","First prize\nJunior"\r\nD'Souza,"Line\r\nbreak"\r\n`
    );
  });

  it.each(["=SUM(A1)", "+91 98765 43210", "-1", "@cmd", "\tTab", "\rCR"])(
    "stops a spreadsheet reading %j as a formula",
    (cell) => {
      const csv = bundleManifestCsv(["Name"], [[cell]]);
      const body = csv.slice(`${BOM}Name\r\n`.length, -2);
      expect(body.replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    }
  );

  it("keeps Devanagari as it is", () => {
    expect(bundleManifestCsv(["Name"], [["आशा राव"]])).toBe(
      `${BOM}Name\r\nआशा राव\r\n`
    );
  });

  it("writes the header alone when there are no rows", () => {
    expect(bundleManifestCsv(["File", "Number"], [])).toBe(
      `${BOM}File,Number\r\n`
    );
  });

  it("refuses a row that doesn't match the header", () => {
    expect(() => bundleManifestCsv(["File", "Number"], [["only one"]])).toThrow(
      RangeError
    );
  });
});
