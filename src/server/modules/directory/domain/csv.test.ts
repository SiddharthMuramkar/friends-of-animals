import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits lines and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("reads quoted fields with commas, quotes and line breaks", () => {
    expect(
      parseCsv('name,note\r\n"Camp, Pune","say ""hi""\nthere"\r\n')
    ).toEqual([
      ["name", "note"],
      ["Camp, Pune", 'say "hi"\nthere'],
    ]);
  });

  it("keeps empty fields and a last line without a newline", () => {
    expect(parseCsv("a,,c\n,,")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("drops a byte-order mark", () => {
    expect(parseCsv("﻿pincode\n411001")).toEqual([["pincode"], ["411001"]]);
  });

  it("reads nothing from an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });
});
