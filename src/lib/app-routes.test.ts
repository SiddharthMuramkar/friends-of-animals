import { describe, expect, it } from "vitest";

import { APP_ROUTES, isSignedInPage, isSignedInPath } from "./app-routes";

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

  it("leaves public pages alone, even ones that start alike", () => {
    expect(isSignedInPath("/sign-in")).toBe(false);
    expect(isSignedInPath("/accountability")).toBe(false);
    expect(isSignedInPath("/")).toBe(false);
  });
});

describe("isSignedInPage", () => {
  it("knows the contact inbox and each message in it", () => {
    expect(isSignedInPage(APP_ROUTES.adminInbox)).toBe(true);
    expect(
      isSignedInPage("/admin/inbox/01938a00-0000-7000-8113-000000000001")
    ).toBe(true);
  });

  it("knows no other path under a page with a dynamic segment", () => {
    expect(isSignedInPage("/admin/inbox/")).toBe(false);
    expect(isSignedInPage("/admin/inbox/a/b")).toBe(false);
    expect(isSignedInPage("/admin/inboxes/a")).toBe(false);
  });
});
