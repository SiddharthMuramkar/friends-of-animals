import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PATH_HEADER } from "@/lib/second-factor-routes";

import { proxy } from "./proxy";

const SESSION = "foa.session_token=token.signature";

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

describe("proxy, on pages behind sign-in", () => {
  it.each(["/admin/roles", "/auth/step-up", "/account/security"])(
    "sends a visitor without a session cookie from %s to sign in",
    (path) => {
      const response = proxy(request(path));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/sign-in"
      );
    }
  );

  it("passes the page's path and query on, for the staff gate to come back to", () => {
    const response = proxy(request("/admin/roles?user=1", SESSION));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get(`x-middleware-request-${PATH_HEADER}`)).toBe(
      "/admin/roles?user=1"
    );
  });

  it("overwrites a path header the browser sent itself", () => {
    const sneaky = new NextRequest(new URL("/admin", "http://localhost:3000"), {
      headers: { cookie: SESSION, [PATH_HEADER]: "https://example.com" },
    });

    expect(
      proxy(sneaky).headers.get(`x-middleware-request-${PATH_HEADER}`)
    ).toBe("/admin");
  });
});
