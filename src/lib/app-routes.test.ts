import { describe, expect, it } from "vitest";

import { APP_ROUTES, isSignedInPath } from "./app-routes";

describe("isSignedInPath", () => {
  it("covers the account pages", () => {
    expect(isSignedInPath(APP_ROUTES.accountSessions)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.accountConsents)).toBe(true);
    expect(isSignedInPath("/account")).toBe(true);
  });

  it("covers the staff admin pages", () => {
    expect(isSignedInPath(APP_ROUTES.adminConsentDocuments)).toBe(true);
    expect(isSignedInPath("/admin")).toBe(true);
    expect(isSignedInPath("/administration")).toBe(false);
  });

  // The proxy's sign-in redirect and nonce policy, next.config.ts's public
  // policy and check:build's no-shell check all follow SIGNED_IN_PREFIXES,
  // so a page outside them would get none of the signed-in rules.
  it("puts every page in APP_ROUTES under a signed-in prefix", () => {
    for (const path of Object.values(APP_ROUTES)) {
      expect(isSignedInPath(path), path).toBe(true);
    }
  });

  it("leaves public pages alone, even ones that start alike", () => {
    expect(isSignedInPath("/sign-in")).toBe(false);
    expect(isSignedInPath("/accountability")).toBe(false);
    expect(isSignedInPath("/")).toBe(false);
  });
});
