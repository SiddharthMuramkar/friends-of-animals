import { createHash } from "node:crypto";

import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

import {
  createNonce,
  cspHeaderRules,
  publicCsp,
  reportingEndpoints,
  signedInCsp,
  type CspSources,
} from "./csp";
import { themeScript } from "./theme";

/** A policy value as directive -> sources, for readable assertions. */
function directives(value: string): Record<string, string[]> {
  return Object.fromEntries(
    value
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = "", ...sources] = part.split(/\s+/);
        return [name, sources];
      })
  );
}

describe("publicCsp", () => {
  it("allows self-hosted scripts and Next's inline data, and no handlers", () => {
    const header = publicCsp({ appEnv: "preview", nodeEnv: "production" });

    expect(header.key).toBe("Content-Security-Policy");
    expect(directives(header.value)).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'"],
      "script-src-attr": ["'none'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:"],
      "font-src": ["'self'"],
      "connect-src": ["'self'"],
      "frame-src": ["'none'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
      "upgrade-insecure-requests": [],
      "report-uri": ["/api/csp-report"],
      "report-to": ["csp"],
    });
  });

  it("never carries a nonce, so the page can be prerendered", () => {
    for (const appEnv of [undefined, "local", "preview", "staging"]) {
      const { value } = publicCsp({ appEnv, nodeEnv: "production" });
      expect(value).not.toMatch(/nonce-/);
      expect(value).not.toMatch(/'strict-dynamic'/);
    }
  });

  it("reports without enforcing on staging and production (HR-19)", () => {
    for (const appEnv of ["staging", "production"]) {
      const header = publicCsp({ appEnv, nodeEnv: "production" });
      expect(header.key).toBe("Content-Security-Policy-Report-Only");
      // Browsers ignore these two in a report-only policy and warn about it
      // in the console; X-Frame-Options and HSTS cover them meanwhile.
      expect(directives(header.value)).not.toHaveProperty("frame-ancestors");
      expect(directives(header.value)).not.toHaveProperty(
        "upgrade-insecure-requests"
      );
      expect(directives(header.value)["report-uri"]).toEqual([
        "/api/csp-report",
      ]);
    }
  });

  it("enforces locally and on previews, so Seam 2 catches breakage", () => {
    for (const appEnv of [undefined, "local", "preview"]) {
      expect(publicCsp({ appEnv, nodeEnv: "production" }).key).toBe(
        "Content-Security-Policy"
      );
    }
  });

  it("doesn't upgrade requests on a local http server", () => {
    for (const appEnv of [undefined, "local"]) {
      const { value } = publicCsp({ appEnv, nodeEnv: "production" });
      expect(directives(value)).not.toHaveProperty("upgrade-insecure-requests");
      expect(directives(value)["frame-ancestors"]).toEqual(["'none'"]);
    }
  });

  it("allows eval only under next dev", () => {
    const dev = publicCsp({ appEnv: "local", nodeEnv: "development" });
    expect(directives(dev.value)["script-src"]).toEqual([
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
    ]);
    for (const nodeEnv of [undefined, "production", "test"]) {
      const { value } = publicCsp({ appEnv: "local", nodeEnv });
      expect(value).not.toMatch(/unsafe-eval/);
    }
  });
});

describe("signedInCsp", () => {
  const nonce = "c2VjcmV0LW5vbmNlLTEyMw==";
  // The inline theme script in the root layout, by its CSP hash.
  const themeHash = `'sha256-${createHash("sha256").update(themeScript).digest("base64")}'`;

  it("allows only scripts carrying the nonce, and what they load", () => {
    const header = signedInCsp(
      { appEnv: "preview", nodeEnv: "production" },
      nonce
    );

    expect(header.key).toBe("Content-Security-Policy");
    const policy = directives(header.value);
    expect(policy["script-src"]).toEqual([
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      themeHash,
    ]);
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
    expect(policy["script-src-attr"]).toEqual(["'none'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["report-to"]).toEqual(["csp"]);
  });

  it("follows the same rollout mode as public pages", () => {
    const header = signedInCsp(
      { appEnv: "staging", nodeEnv: "production" },
      nonce
    );
    expect(header.key).toBe("Content-Security-Policy-Report-Only");
    expect(header.value).toContain(`'nonce-${nonce}'`);
  });

  it("refuses a nonce that could break out of the header", () => {
    for (const bad of ["", "abc'; script-src *", "a b", "abc\r\nX-Evil: 1"]) {
      expect(() =>
        signedInCsp({ appEnv: "preview", nodeEnv: "production" }, bad)
      ).toThrow(RangeError);
    }
  });
});

describe("createNonce", () => {
  it("makes 128 random bits, base64, fresh on every call", () => {
    const nonces = Array.from({ length: 50 }, () => createNonce());
    for (const value of nonces) expect(value).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  it("is accepted by signedInCsp", () => {
    const value = createNonce();
    expect(
      signedInCsp({ appEnv: "local", nodeEnv: "production" }, value).value
    ).toContain(`'nonce-${value}'`);
  });
});

describe("feature sources", () => {
  const sentry: CspSources = {
    feature: "error tracking",
    directives: { "connect-src": ["https://o1.ingest.sentry.io"] },
  };
  const toolbar: CspSources = {
    feature: "preview toolbar",
    appEnvs: ["preview"],
    areas: ["public"],
    directives: { "frame-src": ["https://vercel.live"] },
  };

  it("adds a feature's origins without loosening anything else", () => {
    const context = {
      appEnv: "preview",
      nodeEnv: "production",
      sources: [sentry],
    };
    for (const header of [
      publicCsp(context),
      signedInCsp(context, "bm9uY2U="),
    ]) {
      const policy = directives(header.value);
      expect(policy["connect-src"]).toEqual([
        "'self'",
        "https://o1.ingest.sentry.io",
      ]);
      expect(policy["default-src"]).toEqual(["'self'"]);
    }
  });

  it("replaces 'none' when a feature needs the directive", () => {
    const { value } = publicCsp({
      appEnv: "preview",
      nodeEnv: "production",
      sources: [toolbar],
    });
    expect(directives(value)["frame-src"]).toEqual(["https://vercel.live"]);
  });

  it("keeps a feature to its environments and areas", () => {
    const staging = publicCsp({
      appEnv: "staging",
      nodeEnv: "production",
      sources: [toolbar],
    });
    expect(directives(staging.value)["frame-src"]).toEqual(["'none'"]);
    const signedIn = signedInCsp(
      { appEnv: "preview", nodeEnv: "production", sources: [toolbar] },
      "bm9uY2U="
    );
    expect(directives(signedIn.value)["frame-src"]).toEqual(["'none'"]);
  });

  it("refuses keywords and wildcards, which would weaken the policy", () => {
    for (const source of [
      "'unsafe-inline'",
      "'unsafe-eval'",
      "*",
      "https:",
      "https://*",
      "data:",
      "http://cdn.example.test",
    ]) {
      expect(() =>
        publicCsp({
          appEnv: "preview",
          nodeEnv: "production",
          sources: [{ feature: "bad", directives: { "script-src": [source] } }],
        })
      ).toThrow(RangeError);
    }
  });
});

describe("reportingEndpoints", () => {
  it("names the report endpoint for report-to", () => {
    expect(reportingEndpoints()).toEqual({
      key: "Reporting-Endpoints",
      value: 'csp="/api/csp-report"',
    });
  });
});

describe("cspHeaderRules", () => {
  const context = { appEnv: "preview", nodeEnv: "production" };
  const POLICY_KEYS = [
    "Content-Security-Policy",
    "Content-Security-Policy-Report-Only",
  ];

  /**
   * The headers the rules send on `pathname`, matched as Next matches
   * next.config.ts `headers()`: at run time under `next start`, and by the
   * routes-manifest regex that Vercel reads. The two must agree.
   */
  function headersFor(
    rules: ReturnType<typeof cspHeaderRules>,
    pathname: string
  ) {
    return rules.flatMap((rule) => {
      const atRuntime =
        getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(
          pathname
        ) !== false;
      const inManifest = new RegExp(
        buildCustomRoute("header", rule).regex
      ).test(pathname);
      expect(inManifest, `manifest and run time agree on ${pathname}`).toBe(
        atRuntime
      );
      return atRuntime ? rule.headers : [];
    });
  }

  it("sends the public policy on every path outside the signed-in tree", () => {
    const rules = cspHeaderRules(context, ["/account"]);
    for (const pathname of [
      "/",
      "/about",
      "/blog/kolam",
      "/sign-in",
      "/accounts",
      "/api/csp-report",
      "/_next/static/chunks/main.js",
    ]) {
      const policies = headersFor(rules, pathname).filter((h) =>
        POLICY_KEYS.includes(h.key)
      );
      expect(policies, pathname).toEqual([publicCsp(context)]);
    }
  });

  it("leaves the signed-in tree to the proxy's nonce policy", () => {
    const rules = cspHeaderRules(context, ["/account", "/admin"]);
    for (const pathname of [
      "/account",
      "/account/sessions",
      "/account/sessions/other",
      "/admin",
      "/admin/settings",
    ]) {
      const keys = headersFor(rules, pathname).map((h) => h.key);
      for (const key of POLICY_KEYS) expect(keys, pathname).not.toContain(key);
    }
    expect(headersFor(rules, "/administrator")).toContainEqual(
      publicCsp(context)
    );
  });

  it("names the report endpoint on every path, signed-in ones included", () => {
    const rules = cspHeaderRules(context, ["/account"]);
    for (const pathname of ["/", "/about", "/account/sessions"]) {
      expect(headersFor(rules, pathname), pathname).toContainEqual(
        reportingEndpoints()
      );
    }
  });

  it("refuses a prefix that isn't a plain lower-case path", () => {
    for (const prefix of ["/", "/acc(ount", "/account/", "/Account", "/a.b"]) {
      expect(
        () => cspHeaderRules(context, [prefix as `/${string}`]),
        prefix
      ).toThrow(RangeError);
    }
  });
});
