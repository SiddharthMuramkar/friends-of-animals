import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import {
  getRewrittenUrl,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIGNED_IN_PREFIXES } from "@/lib/app-routes";
import { publicCsp } from "@/lib/csp";
import { cspContext } from "@/lib/csp-sources";
import { createProxy } from "@/request-proxy";

import { config } from "./proxy";

// Competition slugs are checked against the database (#70); here none is
// published. src/proxy.competitions.test.ts covers that check.
const proxy = createProxy({ isPublishedCompetitionSlug: async () => false });

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
  it("sends a signed-in page the nonce policy, and renders it with the same nonce", async () => {
    vi.stubEnv("APP_ENV", "preview");
    const response = await proxy(request("/account/sessions", SESSION));

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

  it("makes a fresh nonce for every request", async () => {
    const nonces = new Set(
      await Promise.all(
        Array.from({ length: 5 }, async () => {
          const response = await proxy(request("/account/sessions", SESSION));
          return pageHeaders(response).get("x-nonce");
        })
      )
    );
    expect(nonces.size).toBe(5);
  });

  it("only reports on staging and production, and Next still reads the nonce", async () => {
    for (const appEnv of ["staging", "production"]) {
      vi.stubEnv("APP_ENV", appEnv);
      const response = await proxy(request("/account/sessions", SESSION));

      expect(response.headers.get("content-security-policy")).toBeNull();
      const policy = response.headers.get(
        "content-security-policy-report-only"
      );
      const page = pageHeaders(response);
      expect(page.get("content-security-policy-report-only")).toBe(policy);
      expect(getScriptNonceFromHeader(policy!)).toBe(page.get("x-nonce"));
    }
  });

  it("replaces any policy or nonce the client sent", async () => {
    vi.stubEnv("APP_ENV", "staging");
    const response = await proxy(
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

  it("answers any other signed-in path with the static 404 under the public policy", async () => {
    vi.stubEnv("APP_ENV", "preview");
    // A request-time notFound() under the signed-in layout could only stream
    // a 200; the prerendered 404 has no nonce on its scripts.
    for (const path of ["/account", "/account/nope", "/account/sessions/x"]) {
      const response = await proxy(request(path, SESSION));

      expect(getRewrittenUrl(response), path).toBe(
        "https://foa.example.test/__not-found"
      );
      expect(response.headers.get("content-security-policy"), path).toBe(
        publicCsp(cspContext()).value
      );
      expect(forwarded(response), path).toBeUndefined();
    }
  });

  it("sends a competition's edit and preview pages the nonce policy, for any id", async () => {
    vi.stubEnv("APP_ENV", "preview");
    for (const path of [
      "/admin/competitions/0193f5d2-7a1b-7c3d-8e4f-a1b2c3d4e5f6/edit",
      "/admin/competitions/0193f5d2-7a1b-7c3d-8e4f-a1b2c3d4e5f6/preview",
      "/admin/competitions/any-id/preview",
    ]) {
      const response = await proxy(request(path, SESSION));
      expect(getRewrittenUrl(response), path).toBeNull();
      const page = pageHeaders(response);
      expect(page.get("x-nonce"), path).toEqual(expect.any(String));
    }
  });

  it("still answers admin paths that aren't pages with the static 404", async () => {
    for (const path of [
      "/admin",
      "/admin/competitions/an-id",
      "/admin/competitions/an-id/delete",
      "/admin/competitions/an-id/edit/more",
      "/admin/competitions//edit",
    ]) {
      const response = await proxy(request(path, SESSION));
      expect(getRewrittenUrl(response), path).toBe(
        "https://foa.example.test/__not-found"
      );
    }
  });

  it("still sends a visitor with no session cookie to sign in", async () => {
    const response = await proxy(request("/account/sessions"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foa.example.test/sign-in"
    );
  });

  it("leaves public pages to next.config.ts headers()", async () => {
    for (const path of [
      "/blog/kinder-skies-in-kite-season",
      "/blog/no-such-story",
      "/competitions/no-such-competition",
    ]) {
      const response = await proxy(request(path, SESSION));
      for (const key of POLICY_KEYS) {
        expect(response.headers.get(key), path).toBeNull();
        expect(forwarded(response)?.get(key) ?? null, path).toBeNull();
      }
    }
  });

  it("runs on every path under SIGNED_IN_PREFIXES", async () => {
    for (const prefix of SIGNED_IN_PREFIXES) {
      for (const path of [prefix, `${prefix}/sessions`, `${prefix}/a/b`]) {
        const url = `https://foa.example.test${path}`;
        expect(unstable_doesMiddlewareMatch({ config, url }), path).toBe(true);
      }
    }
  });
});
