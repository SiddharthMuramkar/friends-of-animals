import { describe, expect, it } from "vitest";

import { securityHeaders, strictTransportSecurity } from "./security-headers";

const asRecord = (appEnv: string | undefined) =>
  Object.fromEntries(securityHeaders(appEnv).map((h) => [h.key, h.value]));

describe("securityHeaders", () => {
  it("sends the §13.1 headers other than the CSP", () => {
    expect(asRecord("production")).toEqual({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    });
  });

  it("leaves the CSP to csp.ts and sends no duplicate keys", () => {
    for (const appEnv of [undefined, "local", "preview", "production"]) {
      const keys = securityHeaders(appEnv).map((h) => h.key.toLowerCase());
      expect(keys).not.toContain("content-security-policy");
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("strictTransportSecurity", () => {
  it("covers subdomains for two years only in production", () => {
    expect(strictTransportSecurity("production")).toBe(
      "max-age=63072000; includeSubDomains"
    );
  });

  it("leaves subdomains alone everywhere else", () => {
    for (const appEnv of [undefined, "local", "preview", "staging"]) {
      expect(strictTransportSecurity(appEnv)).toBe("max-age=31536000");
    }
  });

  it("never asks to be preloaded", () => {
    for (const appEnv of [undefined, "staging", "production"]) {
      expect(strictTransportSecurity(appEnv)).not.toContain("preload");
    }
  });
});
