import { describe, expect, it } from "vitest";

import { APP_ROUTES, isSignedInPath } from "./app-routes";

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
