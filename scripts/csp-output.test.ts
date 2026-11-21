import { describe, expect, it } from "vitest";

import { cspOutputFailures, inlineHandlers } from "./csp-output";

/** A prerender-manifest route entry, as `next build` writes it. */
function entry(response: "complete" | "initial" | "empty", srcRoute: string) {
  return { response, srcRoute, htmlSize: response === "empty" ? 0 : 1200 };
}

/** A build in which every check passes. */
function goodBuild() {
  return {
    manifest: {
      routes: {
        "/": entry("complete", "/"),
        "/donate": entry("initial", "/donate"),
        "/blog/kolam": entry("complete", "/blog/[slug]"),
        "/blog/kites": entry("initial", "/blog/[slug]"),
        "/account/sessions": entry("empty", "/account/sessions"),
      },
      dynamicRoutes: {
        "/blog/[slug]": { response: "empty" },
        "/account/[[...missing]]": { response: "empty" },
      },
    },
    routes: [
      { path: "/" as const },
      { path: "/donate" as const },
      { path: "/blog/[slug]" as const },
      { path: "/styleguide" as const, nonProduction: true as const },
    ],
    signedInPrefixes: ["/account"] as const,
    pages: [
      { page: "/", html: '<html><body><a href="/donate">Donate</a></body>' },
    ],
  };
}

describe("cspOutputFailures", () => {
  it("passes a build whose public pages are prerendered and handler-free", () => {
    expect(cspOutputFailures(goodBuild())).toEqual([]);
  });

  it("fails a public route that has no static shell", () => {
    const build = goodBuild();
    build.manifest.routes["/donate"] = entry("empty", "/donate");
    delete (build.manifest.routes as Record<string, unknown>)["/"];

    expect(cspOutputFailures(build)).toEqual([
      "/ is not prerendered, so it can't keep the public CSP without a nonce.",
      "/donate is not prerendered, so it can't keep the public CSP without a nonce.",
    ]);
  });

  it("fails a dynamic public route with no prerendered path", () => {
    const build = goodBuild();
    build.manifest.routes["/blog/kites"] = entry("empty", "/blog/[slug]");
    delete (build.manifest.routes as Record<string, unknown>)["/blog/kolam"];

    expect(cspOutputFailures(build)).toEqual([
      "/blog/[slug] is not prerendered, so it can't keep the public CSP without a nonce.",
    ]);
  });

  it("skips routes that aren't served in production", () => {
    const build = goodBuild();
    // /styleguide is in no build's manifest here: only its flag excuses it.
    const served = {
      ...build,
      routes: build.routes.map(({ path }) => ({ path })),
    };

    expect(cspOutputFailures(build)).toEqual([]);
    expect(cspOutputFailures(served)).toEqual([
      "/styleguide is not prerendered, so it can't keep the public CSP without a nonce.",
    ]);
  });

  it("fails a signed-in route with a static shell, whose scripts would lack the nonce", () => {
    const build = goodBuild();
    build.manifest.routes["/account/sessions"] = entry(
      "initial",
      "/account/sessions"
    );

    expect(cspOutputFailures(build)).toEqual([
      "/account/sessions has a static shell, so its scripts can't carry the request's CSP nonce.",
    ]);
  });

  it("fails a prerendered page with an inline handler or a javascript: URL", () => {
    const build = goodBuild();
    build.pages.push({
      page: "/about",
      html: '<button type="button" onclick="go()">Go</button><a href="javascript:void(0)">x</a>',
    });

    expect(cspOutputFailures(build)).toEqual([
      "/about has an onclick attribute on <button>, which script-src-attr 'none' blocks.",
      "/about has a javascript: URL in <a href>, which the CSP blocks.",
    ]);
  });
});

describe("inlineHandlers", () => {
  it("finds event handler attributes in any case and quoting", () => {
    expect(
      inlineHandlers(
        "<img src=/a.png onerror=alert(1)><div ONMOUSEOVER='x()'></div>" +
          '<body onload="init()">'
      )
    ).toEqual([
      "an onerror attribute on <img>",
      "an onmouseover attribute on <div>",
      "an onload attribute on <body>",
    ]);
  });

  it("finds javascript: URLs however they are spaced or cased", () => {
    expect(
      inlineHandlers(
        '<a href=" JavaScript:alert(1)">a</a>' +
          "<form action='javascript:go()'></form>" +
          '<button formaction="javascript:x">b</button>' +
          '<iframe src="javascript:x"></iframe>'
      )
    ).toEqual([
      "a javascript: URL in <a href>",
      "a javascript: URL in <form action>",
      "a javascript: URL in <button formaction>",
      "a javascript: URL in <iframe src>",
    ]);
  });

  it("ignores text, script and style bodies, and look-alike attributes", () => {
    expect(
      inlineHandlers(
        "<p>Type onclick=go() to learn about javascript:</p>" +
          '<script>self.__next_f.push([1,"<a onclick=\\"x\\">"])</script>' +
          "<style>a[onclick]{color:red}</style>" +
          '<a href="/blog/javascript-basics" data-onclick="x">ok</a>' +
          '<meta name="description" content="a > b onclick=x">' +
          '<div aria-label="online"></div>'
      )
    ).toEqual([]);
  });
});
