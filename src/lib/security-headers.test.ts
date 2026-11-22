import { describe, expect, it } from "vitest";

import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";

import { payFeesPath } from "./app-routes";
import {
  checkoutPageHeaders,
  securityHeaders,
  strictTransportSecurity,
} from "./security-headers";

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

describe("checkoutPageHeaders", () => {
  const rules = checkoutPageHeaders();
  const matching = (path: string) =>
    rules.filter((rule) => getPathMatch(rule.source)(path) !== false);

  it("lets Razorpay Checkout use the Payment Request API and keep its popups, on the pay page only", () => {
    const [rule, ...others] = matching(
      "/institution/registrations/NEIGH27-I-5EED1/pay"
    );

    expect(others).toEqual([]);
    expect(
      Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]))
    ).toEqual({
      "Permissions-Policy":
        'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com")',
      // Checkout opens bank and wallet pages in popups and watches them.
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    });
  });

  it("follows the pay page wherever its route goes", () => {
    const { pathname } = new URL(
      payFeesPath("NEIGH27-I-5EED1", "0193a8f0-0000-7000-8000-000000000001"),
      "http://localhost:3000"
    );

    expect(matching(pathname)).toHaveLength(1);
  });

  it("leaves every other page's headers as they are", () => {
    for (const path of [
      "/",
      "/institution/registrations/NEIGH27-I-5EED1",
      "/institution/registrations/NEIGH27-I-5EED1/payments/0193a8f0-0000-7000-8000-000000000001",
      "/account/sessions",
    ]) {
      expect(matching(path), path).toEqual([]);
    }
  });

  it("only overrides keys every page already sends", () => {
    const everyPage = new Set(securityHeaders("production").map((h) => h.key));
    for (const rule of rules) {
      for (const { key } of rule.headers) expect(everyPage).toContain(key);
    }
  });
});
