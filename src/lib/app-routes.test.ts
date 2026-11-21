import { describe, expect, it } from "vitest";

import { adminInstitutionPath, APP_ROUTES, isSignedInPath } from "./app-routes";

describe("isSignedInPath", () => {
  it("covers the account pages", () => {
    expect(isSignedInPath(APP_ROUTES.accountSessions)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.accountConsents)).toBe(true);
    expect(isSignedInPath("/account")).toBe(true);
  });

  it("covers the admin pages", () => {
    expect(isSignedInPath(APP_ROUTES.adminSettings)).toBe(true);
    expect(isSignedInPath("/admin")).toBe(true);
    expect(isSignedInPath("/administration")).toBe(false);
  });

  it("covers the institution pages and the admin area", () => {
    expect(isSignedInPath(APP_ROUTES.institutionRegister)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.myInstitution)).toBe(true);
    expect(
      isSignedInPath(
        adminInstitutionPath("01938a00-0000-7000-8000-000000001001")
      )
    ).toBe(true);
  });

  it("leaves a public list of institutions open, should one come", () => {
    expect(isSignedInPath("/institutions")).toBe(false);
    expect(isSignedInPath("/institutional-partners")).toBe(false);
  });

  it("leaves public pages alone, even ones that start alike", () => {
    expect(isSignedInPath("/sign-in")).toBe(false);
    expect(isSignedInPath("/accountability")).toBe(false);
    expect(isSignedInPath("/")).toBe(false);
  });
});
