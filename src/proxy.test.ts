import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";

const SESSION_COOKIE = "foa.session_token=x";

/** What the proxy does with a request for `path`: its rewrite or redirect. */
function outcome(path: string, cookie?: string) {
  const response = proxy(
    new NextRequest(`https://example.test${path}`, {
      headers: cookie ? { cookie } : {},
    })
  );
  return {
    rewrite: response.headers.get("x-middleware-rewrite"),
    redirect: response.headers.get("location"),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("proxy: the file upload demo", () => {
  it("is a 404 in production, signed in or not", () => {
    vi.stubEnv("APP_ENV", "production");

    for (const cookie of [undefined, SESSION_COOKIE]) {
      expect(outcome("/account/files", cookie)).toEqual({
        rewrite: "https://example.test/__not-found",
        redirect: null,
      });
    }
  });

  it.each(["preview", "staging", "local"])(
    "sends a visitor to sign in under APP_ENV=%s",
    (name) => {
      vi.stubEnv("APP_ENV", name);

      expect(outcome("/account/files").redirect).toBe(
        "https://example.test/sign-in"
      );
    }
  );

  it("leaves the other account pages to the sign-in check in production", () => {
    vi.stubEnv("APP_ENV", "production");

    expect(outcome("/account/sessions")).toEqual({
      rewrite: null,
      redirect: "https://example.test/sign-in",
    });
  });
});
