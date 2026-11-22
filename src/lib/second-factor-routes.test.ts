import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "./app-routes";
import { safeNext, secondFactorPath } from "./second-factor-routes";

describe("safeNext", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeNext("/admin/roles?user=1")).toBe("/admin/roles?user=1");
    expect(safeNext("/account/security")).toBe("/account/security");
  });

  it("refuses anything that could leave the site", () => {
    for (const raw of [
      "https://example.com/admin",
      "//example.com",
      "/\\example.com",
      "\\\\example.com",
      "javascript:alert(1)",
      "admin/roles",
      "",
      "/ok\u0000",
      "/a\nb",
      undefined,
      ["/admin"],
    ]) {
      expect(safeNext(raw)).toBeNull();
    }
  });
});

describe("secondFactorPath", () => {
  it("sends each second-factor refusal to the page that lifts it", () => {
    expect(secondFactorPath("enrolment_required", "/admin/roles")).toBe(
      `${APP_ROUTES.accountSecurity}?next=%2Fadmin%2Froles`
    );
    expect(secondFactorPath("second_factor_required", "/admin/roles")).toBe(
      `${APP_ROUTES.secondFactor}?next=%2Fadmin%2Froles`
    );
    expect(secondFactorPath("step_up_required", "/admin/roles?x=1")).toBe(
      `${APP_ROUTES.stepUp}?next=%2Fadmin%2Froles%3Fx%3D1`
    );
  });

  it("drops a return path that isn't safe", () => {
    expect(secondFactorPath("step_up_required", "https://example.com")).toBe(
      APP_ROUTES.stepUp
    );
    expect(secondFactorPath("second_factor_required")).toBe(
      APP_ROUTES.secondFactor
    );
  });

  it("has nowhere to send a plain refusal", () => {
    expect(secondFactorPath("forbidden", "/admin")).toBeNull();
  });
});
