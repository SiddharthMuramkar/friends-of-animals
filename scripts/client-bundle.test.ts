import { describe, expect, it } from "vitest";

import { initialScripts, newerSyntax, prerenderedPage } from "./client-bundle";

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

describe("initialScripts", () => {
  it("lists a page's chunks in order, without the noModule polyfills", () => {
    const html =
      '<link rel="preload" as="script" href="/_next/static/chunks/c.js"/>' +
      '<script src="/_next/static/chunks/a.js" async=""></script>' +
      '<script src="/_next/static/chunks/polyfill.js" noModule=""></script>' +
      '<script src="/_next/static/chunks/c.js" id="_R_" async=""></script>' +
      '<script>self.__next_f.push([1,"<script src=\\"x.js\\">"])</script>';
    expect(initialScripts(html)).toEqual([
      "/_next/static/chunks/a.js",
      "/_next/static/chunks/c.js",
    ]);
  });

  it("counts a chunk once and skips scripts from elsewhere", () => {
    const html =
      '<script async src="/_next/static/chunks/a.js"></script>' +
      '<script src="/_next/static/chunks/a.js"></script>' +
      '<script src="https://example.com/x.js"></script>';
    expect(initialScripts(html)).toEqual(["/_next/static/chunks/a.js"]);
  });
});

describe("prerenderedPage", () => {
  const hash = "9f".repeat(32);

  it("reads App Router pages from server/app, as a plain next build writes them", () => {
    expect(prerenderedPage("app/index.html")).toBe("/");
    expect(prerenderedPage("app/donate.html")).toBe("/donate");
    expect(prerenderedPage("app/competitions/kinder-skies.html")).toBe(
      "/competitions/kinder-skies"
    );
  });

  it("reads them from the route cache, as a build with a deployment adapter (Vercel) writes them", () => {
    expect(prerenderedPage(`route-cache/APP_PAGE/${hash}/$/index.html`)).toBe(
      "/"
    );
    expect(prerenderedPage(`route-cache/APP_PAGE/${hash}/$/donate.html`)).toBe(
      "/donate"
    );
    expect(
      prerenderedPage(`route-cache/APP_PAGE/${hash}/$/blog/two-pilots.html`)
    ).toBe("/blog/two-pilots");
  });

  it("skips HTML that isn't an App Router page", () => {
    expect(prerenderedPage("pages/404.html")).toBeUndefined();
    expect(
      prerenderedPage(`route-cache/APP_ROUTE/${hash}/$/robots.txt.html`)
    ).toBeUndefined();
    expect(prerenderedPage("app/donate.rsc")).toBeUndefined();
  });
});
