import { describe, expect, it } from "vitest";

import { decimalCell, toCsv } from "./csv";

const BOM = "﻿";

describe("toCsv", () => {
  it("starts with a UTF-8 byte order mark and ends every row with CRLF", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["c", "d"],
      ])
    ).toBe(`${BOM}a,b\r\nc,d\r\n`);
  });

  it("leaves the mark out when asked", () => {
    expect(toCsv([["a"]], { bom: false })).toBe("a\r\n");
  });

  it("quotes cells holding a comma, a quote or a line break, doubling quotes", () => {
    expect(
      toCsv(
        [["Rent, May", 'Paid "in full"', "line one\nline two", "cr\rhere"]],
        {
          bom: false,
        }
      )
    ).toBe(
      `"Rent, May","Paid ""in full""","line one\nline two","cr\rhere"\r\n`
    );
  });

  it("writes null and undefined as empty cells", () => {
    expect(toCsv([["a", null, undefined, "d"]], { bom: false })).toBe(
      "a,,,d\r\n"
    );
  });

  it("keeps non-ASCII text as it is", () => {
    expect(toCsv([["दान", "₹"]], { bom: false })).toBe("दान,₹\r\n");
  });
});

describe("formula neutralising", () => {
  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+91 98765", "'+91 98765"],
    ["-5 adjustment", "'-5 adjustment"],
    ["@cmd", "'@cmd"],
    ["\tindent", "'\tindent"],
  ])("prefixes text %j with an apostrophe", (text, expected) => {
    expect(toCsv([[text]], { bom: false })).toBe(`${expected}\r\n`);
  });

  it("neutralises before quoting", () => {
    expect(toCsv([['=HYPERLINK("x")']], { bom: false })).toBe(
      `"'=HYPERLINK(""x"")"\r\n`
    );
    expect(toCsv([["\rx"]], { bom: false })).toBe(`"'\rx"\r\n`);
  });

  it("leaves ordinary text alone", () => {
    expect(toCsv([["Donation 4200"]], { bom: false })).toBe(
      "Donation 4200\r\n"
    );
  });
});

describe("numeric cells", () => {
  it("writes numbers and bigints as numbers, negatives included", () => {
    expect(toCsv([[-12, 3.5, -1234n, 0n]], { bom: false })).toBe(
      "-12,3.5,-1234,0\r\n"
    );
  });

  it("writes decimal cells as numbers, never as neutralised text", () => {
    expect(
      toCsv([[decimalCell("-1250.50"), decimalCell("0.05")]], { bom: false })
    ).toBe("-1250.50,0.05\r\n");
  });

  it("refuses a decimal cell that isn't a plain decimal", () => {
    for (const value of ["=1", "1e5", "1,000.00", "", "-", "1.", ".5"]) {
      expect(() => decimalCell(value)).toThrow(RangeError);
    }
  });

  it("refuses numbers that aren't finite", () => {
    expect(() => toCsv([[Number.NaN]])).toThrow(RangeError);
    expect(() => toCsv([[Number.POSITIVE_INFINITY]])).toThrow(RangeError);
  });
});
