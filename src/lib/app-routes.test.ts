import { describe, expect, it } from "vitest";

import {
  adminCmsDocumentPath,
  APP_ROUTES,
  isSignedInPage,
  isSignedInPath,
} from "./app-routes";

describe("isSignedInPath", () => {
  it("covers the account pages", () => {
    expect(isSignedInPath(APP_ROUTES.accountSessions)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.accountConsents)).toBe(true);
    expect(isSignedInPath("/account")).toBe(true);
  });

  it("leaves public pages alone, even ones that start alike", () => {
    expect(isSignedInPath("/sign-in")).toBe(false);
    expect(isSignedInPath("/accountability")).toBe(false);
    expect(isSignedInPath("/")).toBe(false);
  });
});

describe("isSignedInPage", () => {
  it("knows the CMS list and one editor page per document", () => {
    expect(isSignedInPage(APP_ROUTES.adminCms)).toBe(true);
    expect(isSignedInPage(adminCmsDocumentPath("legal_privacy"))).toBe(true);
    expect(isSignedInPage("/admin/cms/legal_child_protection")).toBe(true);
    expect(isSignedInPath("/admin/cms/legal_privacy")).toBe(true);
  });

  it("refuses an editor path for a document that doesn't exist", () => {
    expect(isSignedInPage("/admin/cms/legal_cookies")).toBe(false);
    expect(isSignedInPage("/admin/cms/legal_privacy/extra")).toBe(false);
    expect(isSignedInPage("/admin/cms/")).toBe(false);
  });
});
