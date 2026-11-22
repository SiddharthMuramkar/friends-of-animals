import { describe, expect, it } from "vitest";

import {
  CsvSyntaxError,
  csvRecords,
  formatCsv,
  neutraliseFormula,
  parseCsv,
  restoreFormula,
} from "./csv";

describe("parseCsv", () => {
  it("reads comma-separated records", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual({
      ok: true,
      records: [
        ["a", "b", "c"],
        ["1", "2", "3"],
      ],
    });
  });

  it.each([
    ["CRLF", "a,b\r\n1,2\r\n"],
    ["LF", "a,b\n1,2\n"],
    ["CR", "a,b\r1,2\r"],
  ])("ends records at %s, ignoring one trailing line ending", (_, text) => {
    expect(parseCsv(text)).toEqual({
      ok: true,
      records: [
        ["a", "b"],
        ["1", "2"],
      ],
    });
  });

  it("reads nothing from an empty text", () => {
    expect(parseCsv("")).toEqual({ ok: true, records: [] });
  });

  it("keeps empty fields, including a trailing one", () => {
    expect(parseCsv("a,,c,\n")).toEqual({
      ok: true,
      records: [["a", "", "c", ""]],
    });
  });

  it("reads a blank line as one empty field", () => {
    expect(parseCsv("a\n\nb")).toEqual({
      ok: true,
      records: [["a"], [""], ["b"]],
    });
  });

  it("reads quoted fields with commas, doubled quotes and line breaks", () => {
    expect(
      parseCsv('name,address\r\n"Rao, Aanya","12 ""Green"" Lane\r\nPune"\r\n')
    ).toEqual({
      ok: true,
      records: [
        ["name", "address"],
        ["Rao, Aanya", '12 "Green" Lane\r\nPune'],
      ],
    });
  });

  it("reads an empty quoted field", () => {
    expect(parseCsv('"",x')).toEqual({ ok: true, records: [["", "x"]] });
  });

  it("keeps spaces around unquoted fields", () => {
    expect(parseCsv(" a , b ")).toEqual({
      ok: true,
      records: [[" a ", " b "]],
    });
  });

  it("takes a quote inside an unquoted field literally", () => {
    expect(parseCsv('5" tall,x')).toEqual({
      ok: true,
      records: [['5" tall', "x"]],
    });
  });

  it("drops a leading byte order mark", () => {
    expect(parseCsv("\uFEFFa,b")).toEqual({ ok: true, records: [["a", "b"]] });
  });

  it("keeps Indic scripts and emoji as they are", () => {
    expect(parseCsv("आन्या राव,🐕")).toEqual({
      ok: true,
      records: [["आन्या राव", "🐕"]],
    });
  });

  it("refuses a quote that never closes, naming the line it opened on", () => {
    expect(parseCsv('a,b\n1,"two\n3,4')).toEqual({
      ok: false,
      reason: "unterminated_quote",
      line: 2,
    });
  });

  it("refuses text after a closing quote, naming its line", () => {
    expect(parseCsv('a,b\n"one"x,2')).toEqual({
      ok: false,
      reason: "text_after_quote",
      line: 2,
    });
  });

  it("counts lines inside quoted fields when naming a later line", () => {
    expect(parseCsv('"a\nb",c\n"d"e')).toEqual({
      ok: false,
      reason: "text_after_quote",
      line: 3,
    });
  });
});

describe("csvRecords", () => {
  it("reads one record at a time, so a reader can stop before the rest", () => {
    const records = csvRecords('a,b\n1,2\n"never closed');
    expect(records.next()).toEqual({ done: false, value: ["a", "b"] });
    expect(records.next()).toEqual({ done: false, value: ["1", "2"] });
    expect(() => records.next()).toThrow(
      new CsvSyntaxError("unterminated_quote", 3)
    );
  });
});

describe("formatCsv", () => {
  it("joins fields with commas and ends every record with CRLF", () => {
    expect(
      formatCsv([
        ["a", "b"],
        ["1", "2"],
      ])
    ).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes fields holding a comma, a quote or a line break", () => {
    expect(formatCsv([["Rao, Aanya", 'say "hi"', "line\nbreak", "cr\r"]])).toBe(
      '"Rao, Aanya","say ""hi""","line\nbreak","cr\r"\r\n'
    );
  });

  it("round-trips through parseCsv", () => {
    const records = [
      ["full_name", "address", "note"],
      ["Rao, Aanya", '12 "Green" Lane\r\nPune', ""],
      ["आन्या", " spaced ", '5" tall'],
    ];
    expect(parseCsv(formatCsv(records))).toEqual({ ok: true, records });
  });
});

describe("neutraliseFormula", () => {
  it.each([
    ["=SUM(A1:A2)", "'=SUM(A1:A2)"],
    ["+91 98765 43210", "'+91 98765 43210"],
    ["-5", "'-5"],
    ["@cmd", "'@cmd"],
    ["\tx", "'\tx"],
    ["\rx", "'\rx"],
    ["\nx", "'\nx"],
    [" =1", "' =1"],
    ["  +91 98765 43210", "'  +91 98765 43210"],
    ["'=already quoted", "''=already quoted"],
  ])("prefixes %j so a spreadsheet shows it as text", (cell, safe) => {
    expect(neutraliseFormula(cell)).toBe(safe);
  });

  it.each(["Aanya Rao", "2016-03-09", "", "'quoted", "a=b", " a=1", " "])(
    "leaves %j as it is",
    (cell) => {
      expect(neutraliseFormula(cell)).toBe(cell);
    }
  );
});

describe("restoreFormula", () => {
  it.each([
    ["'+91 98765 43210", "+91 98765 43210"],
    ["'=SUM(A1)", "=SUM(A1)"],
    ["''=x", "'=x"],
    ["' =1", " =1"],
    ["'\nx", "\nx"],
  ])("removes the prefix neutraliseFormula added to %j", (cell, original) => {
    expect(restoreFormula(cell)).toBe(original);
  });

  it.each(["'quoted", "Aanya", "", "'", "+91 98765 43210"])(
    "leaves %j as it is",
    (cell) => {
      expect(restoreFormula(cell)).toBe(cell);
    }
  );

  it.each([
    "=1",
    "+91",
    "-",
    "@x",
    "\tx",
    "\nx",
    " =1",
    "' @x",
    "'=x",
    "''@x",
    "plain",
    "'plain",
    "",
    "'",
  ])("undoes neutraliseFormula exactly for %j", (cell) => {
    expect(restoreFormula(neutraliseFormula(cell))).toBe(cell);
  });
});
