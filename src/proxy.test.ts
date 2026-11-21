import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import {
  getRewrittenUrl,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_ROUTES, SIGNED_IN_PREFIXES } from "@/lib/app-routes";
import { publicCsp } from "@/lib/csp";
import { PATH_HEADER } from "@/lib/second-factor-routes";
import { cspContext } from "@/lib/csp-sources";

import { config, proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

const SESSION = { cookie: "foa.session_token=token.signature" };

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://foa.example.test${path}`, { headers });
}

/**
 * The request headers the page renders with, as the proxy forwards them
 * (next/dist/server/web/spec-extension/response.js), or undefined if it
 * forwards the request unchanged.
 */
function forwarded(response: NextResponse): Headers | undefined {
  const keys = response.headers.get("x-middleware-override-headers");
  if (keys === null) return undefined;
  const headers = new Headers();
  for (const key of keys.split(",")) {
    headers.set(key, response.headers.get(`x-middleware-request-${key}`)!);
  }
  return headers;
}

/** The forwarded request headers of a response that must forward some. */
function pageHeaders(response: NextResponse): Headers {
  const headers = forwarded(response);
  expect(headers, "request headers forwarded to the page").toBeDefined();
  return headers!;
}

const POLICY_KEYS = [
  "content-security-policy",
  "content-security-policy-report-only",
];

describe("proxy: the signed-in nonce policy", () => {
  it("sends a signed-in page the nonce policy, and renders it with the same nonce", () => {
    vi.stubEnv("APP_ENV", "preview");
    const response = proxy(request("/account/sessions", SESSION));

    const policy = response.headers.get("content-security-policy");
    expect(policy, "the response's policy").toEqual(expect.any(String));
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    const nonce = getScriptNonceFromHeader(policy!);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);

    const page = pageHeaders(response);
    expect(page.get("content-security-policy")).toBe(policy);
    expect(page.get("x-nonce")).toBe(nonce);
    // The session cookie still reaches the page.
    expect(page.get("cookie")).toBe(SESSION.cookie);
  });

  it("makes a fresh nonce for every request", () => {
    const nonces = new Set(
      Array.from({ length: 5 }, () => {
        const response = proxy(request("/account/sessions", SESSION));
        return pageHeaders(response).get("x-nonce");
      })
    );
    expect(nonces.size).toBe(5);
  });

  it("only reports on staging and production, and Next still reads the nonce", () => {
    for (const appEnv of ["staging", "production"]) {
      vi.stubEnv("APP_ENV", appEnv);
      const response = proxy(request("/account/sessions", SESSION));

      expect(response.headers.get("content-security-policy")).toBeNull();
      const policy = response.headers.get(
        "content-security-policy-report-only"
      );
      const page = pageHeaders(response);
      expect(page.get("content-security-policy-report-only")).toBe(policy);
      expect(getScriptNonceFromHeader(policy!)).toBe(page.get("x-nonce"));
    }
  });

  it("replaces any policy or nonce the client sent", () => {
    vi.stubEnv("APP_ENV", "staging");
    const response = proxy(
      request("/account/sessions", {
        ...SESSION,
        "content-security-policy": "script-src 'nonce-chosenbyclient'",
        "x-nonce": "chosenbyclient",
      })
    );

    const page = pageHeaders(response);
    expect(page.get("content-security-policy")).toBeNull();
    expect(page.get("content-security-policy-report-only")).not.toContain(
      "chosenbyclient"
    );
    expect(page.get("x-nonce")).not.toBe("chosenbyclient");
  });

  it("answers any other signed-in path with the static 404 under the public policy", () => {
    vi.stubEnv("APP_ENV", "preview");
    // A request-time notFound() under the signed-in layout could only stream
    // a 200; the prerendered 404 has no nonce on its scripts.
    for (const path of ["/account", "/account/nope", "/account/sessions/x"]) {
      const response = proxy(request(path, SESSION));

      expect(getRewrittenUrl(response), path).toBe(
        "https://foa.example.test/__not-found"
      );
      expect(response.headers.get("content-security-policy"), path).toBe(
        publicCsp(cspContext()).value
      );
      expect(forwarded(response), path).toBeUndefined();
    }
  });

  it("serves a template's editor, a page with a dynamic segment, but no deeper path (#69)", () => {
    vi.stubEnv("APP_ENV", "preview");
    const editor = proxy(request("/admin/templates/identity.welcome", SESSION));

    expect(pageHeaders(editor).get("x-nonce")).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    for (const path of [
      "/admin/templates/identity.welcome/x",
      "/admin/templates/",
    ]) {
      expect(getRewrittenUrl(proxy(request(path, SESSION))), path).toBe(
        "https://foa.example.test/__not-found"
      );
    }
  });

  it("serves an institution review page with the signed-in nonce", () => {
    vi.stubEnv("APP_ENV", "preview");
    const path = "/admin/institutions/01938a00-0000-7000-8000-000000001001";

    expect(pageHeaders(proxy(request(path, SESSION))).get("x-nonce")).toMatch(
      /^[A-Za-z0-9+/]{22}==$/
    );
    expect(getRewrittenUrl(proxy(request(`${path}/extra`, SESSION)))).toBe(
      "https://foa.example.test/__not-found"
    );
  });

  it("still sends a visitor with no session cookie to sign in", () => {
    const response = proxy(request("/account/sessions"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foa.example.test/sign-in"
    );
  });

  it("leaves public pages to next.config.ts headers()", () => {
    for (const path of [
      "/blog/kinder-skies-in-kite-season",
      "/blog/no-such-story",
      "/competitions/no-such-competition",
    ]) {
      const response = proxy(request(path, SESSION));
      for (const key of POLICY_KEYS) {
        expect(response.headers.get(key), path).toBeNull();
        expect(forwarded(response)?.get(key) ?? null, path).toBeNull();
      }
    }
  });

  it("runs on every path under SIGNED_IN_PREFIXES", () => {
    for (const prefix of SIGNED_IN_PREFIXES) {
      for (const path of [prefix, `${prefix}/sessions`, `${prefix}/a/b`]) {
        const url = `https://foa.example.test${path}`;
        expect(unstable_doesMiddlewareMatch({ config, url }), path).toBe(true);
      }
    }
  });
});

describe("proxy: the page's path, for the staff gate (#60)", () => {
  it.each([
    APP_ROUTES.accountSecurity,
    APP_ROUTES.secondFactor,
    APP_ROUTES.stepUp,
  ])("sends a visitor without a session cookie from %s to sign in", (path) => {
    const response = proxy(request(path));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/sign-in"
    );
  });

  it("renders a signed-in page knowing its path and query, to come back to", () => {
    vi.stubEnv("APP_ENV", "preview");
    const path = `${APP_ROUTES.stepUp}?next=%2Fadmin%2Froles`;

    expect(pageHeaders(proxy(request(path, SESSION))).get(PATH_HEADER)).toBe(
      path
    );
  });

  it("never passes on a path header the browser sent itself", () => {
    vi.stubEnv("APP_ENV", "preview");
    const response = proxy(
      request(APP_ROUTES.accountSecurity, {
        ...SESSION,
        [PATH_HEADER]: "https://example.com",
      })
    );

    expect(pageHeaders(response).get(PATH_HEADER)).toBe(
      APP_ROUTES.accountSecurity
    );
  });
});
