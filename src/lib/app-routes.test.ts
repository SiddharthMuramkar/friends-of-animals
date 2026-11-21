import { describe, expect, it } from "vitest";

import { APP_ROUTES, isSignedInPage, isSignedInPath } from "./app-routes";

const COMPETITION_ID = "01938a00-0000-7000-8000-000000002001";

describe("isSignedInPage", () => {
  it("knows every listed page", () => {
    for (const path of Object.values(APP_ROUTES)) {
      expect(isSignedInPage(path), path).toBe(true);
    }
  });

  it("knows a competition's edit and preview pages, whatever its id", () => {
    expect(isSignedInPage(`/admin/competitions/${COMPETITION_ID}/edit`)).toBe(
      true
    );
    expect(
      isSignedInPage(`/admin/competitions/${COMPETITION_ID}/preview`)
    ).toBe(true);
  });

  it("knows no other path, so the proxy answers it with the 404", () => {
    for (const path of [
      "/account",
      "/admin",
      `/admin/competitions/${COMPETITION_ID}`,
      `/admin/competitions/${COMPETITION_ID}/delete`,
      `/admin/competitions/${COMPETITION_ID}/edit/more`,
      "/admin/competitions//edit",
      "/admin/institutions/x/edit",
    ]) {
      expect(isSignedInPage(path), path).toBe(false);
    }
  });
});

describe("isSignedInPath", () => {
  it("covers the account pages", () => {
    expect(isSignedInPath(APP_ROUTES.accountSessions)).toBe(true);
    expect(isSignedInPath("/account")).toBe(true);
  });

  it("covers the admin pages", () => {
    expect(isSignedInPath(APP_ROUTES.adminCompetitions)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.adminNewCompetition)).toBe(true);
    expect(isSignedInPath("/administrators")).toBe(false);
  });

  it("leaves public pages alone, even ones that start alike", () => {
    expect(isSignedInPath("/sign-in")).toBe(false);
    expect(isSignedInPath("/accountability")).toBe(false);
    expect(isSignedInPath("/")).toBe(false);
  });
});
