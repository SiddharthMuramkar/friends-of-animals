import { describe, expect, it } from "vitest";

import { newerSyntax } from "./client-bundle";

describe("newerSyntax", () => {
  it("finds a class static block, minified or not", () => {
    expect(
      newerSyntax("class _ extends l.Component{static{this.contextType=f}}")
    ).toEqual(["class static block"]);
    expect(newerSyntax("class A {\n  static {\n    init();\n  }\n}")).toEqual([
      "class static block",
    ]);
  });

  it("accepts static fields and methods, which Safari 15 parses", () => {
    expect(
      newerSyntax(
        "class _{static #e=this.contextType=f;static x=1;static get(){}}"
      )
    ).toEqual([]);
  });

  it("ignores words that merely end in static", () => {
    expect(newerSyntax("a.static{};var nonstatic{")).toEqual([]);
  });

  it("finds RegExp lookbehind, positive or negative", () => {
    expect(newerSyntax("/(?<=\\$)\\d+/.test(s)")).toEqual([
      "RegExp lookbehind",
    ]);
    expect(newerSyntax('new RegExp("(?<!a)b")')).toEqual(["RegExp lookbehind"]);
  });

  it("accepts named groups, which Safari 11.1 parses", () => {
    expect(newerSyntax("/(?<year>\\d{4})/")).toEqual([]);
  });

  it("reports both kinds at once", () => {
    expect(newerSyntax("class A{static{}};/(?<=a)b/")).toEqual([
      "class static block",
      "RegExp lookbehind",
    ]);
  });
});
