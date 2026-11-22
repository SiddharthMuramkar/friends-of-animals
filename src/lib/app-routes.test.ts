import { describe, expect, it } from "vitest";

import {
  ADMIN_PAYMENTS_REVIEW,
  adminCmsDocumentPath,
  adminPaymentBatchPath,
  adminPaymentReviewCasePath,
  adminInstitutionPath,
  APP_ROUTES,
  guardianChildPath,
  institutionCompetitionsPath,
  institutionRegistrationPath,
  isNonProductionPath,
  newStudentPath,
  payMyRegistrationPath,
  individualRegisterPath,
  individualRegisterSlug,
  isSignedInPage,
  studentImportFilePath,
  studentImportPath,
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

  it("knows the payments pages (#79), though the review list isn't in APP_ROUTES", () => {
    expect(isSignedInPage(ADMIN_PAYMENTS_REVIEW)).toBe(true);
    expect(isSignedInPage(adminPaymentReviewCasePath(COMPETITION_ID))).toBe(
      true
    );
    expect(isSignedInPage(adminPaymentBatchPath(COMPETITION_ID))).toBe(true);
    expect(isSignedInPage("/admin/payments")).toBe(false);
    expect(isSignedInPage("/admin/payments/batches")).toBe(false);
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

  it("knows the pay page of an adult's own registration, whatever its id (#78)", () => {
    const path = payMyRegistrationPath("01938a00-0000-7000-8000-000000009001");
    expect(path).toBe(
      "/participant/registrations/01938a00-0000-7000-8000-000000009001/pay"
    );
    expect(isSignedInPage(path)).toBe(true);
    expect(isSignedInPath(path)).toBe(true);
    expect(
      isSignedInPage(
        "/participant/registrations/01938a00-0000-7000-8000-000000009001"
      )
    ).toBe(false);
  });

  it("knows an adult's register form for any competition, in the signed-in tree (#78)", () => {
    const path = individualRegisterPath("neighbours-on-my-street");
    expect(path).toBe("/participant/register/neighbours-on-my-street");
    expect(isSignedInPage(path)).toBe(true);
    expect(isSignedInPath(path)).toBe(true);
    expect(isSignedInPage("/participant/register")).toBe(false);
    expect(isSignedInPage(`${path}/more`)).toBe(false);
  });

  it("knows a competition's fees, prizes and terms page, whatever its id", () => {
    expect(isSignedInPage(`/admin/competitions/${COMPETITION_ID}/terms`)).toBe(
      true
    );
    expect(
      isSignedInPage(`/admin/competitions/${COMPETITION_ID}/terms/more`)
    ).toBe(false);
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
    ]) {
      expect(isSignedInPage(path), path).toBe(false);
    }
  });

  it("knows a registration's students page and its add-a-student page, for the institution acting", () => {
    const institutionId = "01938a00-0000-7000-8000-000000001001";
    const students = institutionRegistrationPath(
      "NEIGH27-I-5EED1",
      institutionId
    );
    const add = newStudentPath("NEIGH27-I-5EED1", institutionId);

    expect(students).toBe(
      `/institution/registrations/NEIGH27-I-5EED1?institution=${institutionId}`
    );
    expect(add).toBe(
      `/institution/registrations/NEIGH27-I-5EED1/students/new?institution=${institutionId}`
    );
    for (const path of [students, add]) {
      expect(isSignedInPage(path.split("?")[0]!), path).toBe(true);
    }
    expect(
      isSignedInPage("/institution/registrations/NEIGH27-I-5EED1/students")
    ).toBe(false);
  });

  it("knows a registration's student import page and its two CSV files (#76)", () => {
    const institutionId = "01938a00-0000-7000-8000-000000001001";
    const page = studentImportPath("NEIGH27-I-5EED1", institutionId);
    const template = studentImportFilePath(
      "NEIGH27-I-5EED1",
      institutionId,
      "template.csv"
    );
    const sample = studentImportFilePath(
      "NEIGH27-I-5EED1",
      institutionId,
      "sample.csv"
    );

    expect(page).toBe(
      `/institution/registrations/NEIGH27-I-5EED1/import?institution=${institutionId}`
    );
    expect(template).toBe(
      `/institution/registrations/NEIGH27-I-5EED1/import/template.csv?institution=${institutionId}`
    );
    expect(sample).toBe(
      `/institution/registrations/NEIGH27-I-5EED1/import/sample.csv?institution=${institutionId}`
    );
    for (const path of [page, template, sample]) {
      expect(isSignedInPage(path.split("?")[0]!), path).toBe(true);
    }
    expect(
      isSignedInPage(
        "/institution/registrations/NEIGH27-I-5EED1/import/other.csv"
      )
    ).toBe(false);
  });

  it("knows the contact inbox and each message in it", () => {
    expect(isSignedInPage(APP_ROUTES.adminInbox)).toBe(true);
    expect(
      isSignedInPage("/admin/inbox/01938a00-0000-7000-8113-000000000001")
    ).toBe(true);
  });

  it("knows no other path under the inbox", () => {
    expect(isSignedInPage("/admin/inbox/")).toBe(false);
    expect(isSignedInPage("/admin/inbox/a/b")).toBe(false);
    expect(isSignedInPage("/admin/inboxes/a")).toBe(false);
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

  it("puts the guardian pages behind sign-in, one child's page per id (#81)", () => {
    const child = guardianChildPath("01938a00-0000-7000-8000-000000008121");

    expect(child).toBe(
      "/guardian/children/01938a00-0000-7000-8000-000000008121"
    );
    for (const path of [
      APP_ROUTES.guardian,
      APP_ROUTES.guardianRegister,
      APP_ROUTES.guardianNewChild,
      child,
    ]) {
      expect(isSignedInPath(path), path).toBe(true);
      expect(isSignedInPage(path), path).toBe(true);
    }
    expect(isSignedInPath("/guardians")).toBe(false);
    expect(isSignedInPage("/guardian/children")).toBe(false);
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

  it("puts the competitions an institution registers for behind sign-in, for one institution at a time", () => {
    const path = institutionCompetitionsPath(
      "01938a00-0000-7000-8000-000000001001"
    );

    expect(path).toBe(
      "/institution/competitions?institution=01938a00-0000-7000-8000-000000001001"
    );
    expect(isSignedInPage(new URL(path, "http://x").pathname)).toBe(true);
    expect(isSignedInPath(path)).toBe(true);
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

describe("individualRegisterSlug", () => {
  it("is the competition slug of a register form's path, as sent", () => {
    expect(
      individualRegisterSlug(individualRegisterPath("neighbours-on-my-street"))
    ).toBe("neighbours-on-my-street");
    expect(individualRegisterSlug("/participant/register/%E0%A4%A")).toBe(
      "%E0%A4%A"
    );
  });

  it("is null for any other path", () => {
    for (const path of [
      "/participant",
      "/participant/register",
      "/participant/register/",
      "/participant/register/a-slug/more",
      "/participant/registrations/01938a00-0000-7000-8000-000000009001/pay",
      "/competitions/a-slug",
    ]) {
      expect(individualRegisterSlug(path), path).toBeNull();
    }
  });
});
