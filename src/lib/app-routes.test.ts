import { describe, expect, it } from "vitest";

import {
  adminCmsDocumentPath,
  adminInstitutionPath,
  APP_ROUTES,
  isNonProductionPath,
  isSignedInPage,
  isSignedInPath,
  judgingGuidePath,
} from "./app-routes";

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

  it("knows a competition's rubric pages, whatever its id (#88)", () => {
    expect(
      isSignedInPage(`/admin/competitions/${COMPETITION_ID}/rubrics`)
    ).toBe(true);
    expect(
      isSignedInPage(`/admin/competitions/${COMPETITION_ID}/rubrics/essay`)
    ).toBe(true);
  });

  it("knows a competition's judging guide for institutions, whatever its code (#88)", () => {
    expect(isSignedInPage(judgingGuidePath("NEIGH27"))).toBe(true);
    expect(judgingGuidePath("NEIGH27")).toBe(
      "/institution/competitions/NEIGH27/judging-guide"
    );
  });

  it("knows an institution's review page, whatever its id", () => {
    expect(
      isSignedInPage(
        adminInstitutionPath("01938a00-0000-7000-8000-000000001001")
      )
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
      `/admin/competitions/${COMPETITION_ID}/rubrics/essay/edit`,
      "/institution/competitions/NEIGH27",
      "/institution/competitions",
    ]) {
      expect(isSignedInPage(path), path).toBe(false);
    }
  });
});

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

  it("covers the admin pages", () => {
    expect(isSignedInPath(APP_ROUTES.adminCompetitions)).toBe(true);
    expect(isSignedInPath(APP_ROUTES.adminNewCompetition)).toBe(true);
    expect(isSignedInPath("/administrators")).toBe(false);
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
