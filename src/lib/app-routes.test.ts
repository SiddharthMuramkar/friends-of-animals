import { describe, expect, it } from "vitest";

import { APP_ROUTES, isNonProductionPath, isSignedInPath } from "./app-routes";

describe("isSignedInPath", () => {
  it("covers the account pages", () => {
    expect(isSignedInPath(APP_ROUTES.accountSessions)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.accountFiles)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.accountConsents)).toBe(true);
    expect(isSignedInPath("/account")).toBe(true);
  });

  it("covers the staff admin pages", () => {
    expect(isSignedInPath(APP_ROUTES.adminSettings)).toBe(true);
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

  it("covers the dashboard and the admin pages", () => {
    expect(isSignedInPath(APP_ROUTES.dashboard)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.adminRoles)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.adminAudit)).toBe(true);
    expect(isSignedInPath("/admin")).toBe(true);
    expect(isSignedInPath("/administration")).toBe(false);
    expect(isSignedInPath("/dashboards")).toBe(false);
  });

  it("leaves public pages alone, even ones that start alike", () => {
    expect(isSignedInPath("/sign-in")).toBe(false);
    expect(isSignedInPath("/accountability")).toBe(false);
    expect(isSignedInPath("/")).toBe(false);
  });
});

describe("isNonProductionPath", () => {
  it("covers the file upload demo and everything under it", () => {
    expect(isNonProductionPath(APP_ROUTES.accountFiles)).toBe(true);
    expect(isNonProductionPath(`${APP_ROUTES.accountFiles}/x`)).toBe(true);
  });

  it("leaves other account pages alone", () => {
    expect(isNonProductionPath(APP_ROUTES.accountSessions)).toBe(false);
    expect(isNonProductionPath("/account/filesystem")).toBe(false);
    expect(isNonProductionPath("/account")).toBe(false);
  });
});
