import { describe, expect, it } from "vitest";

import {
  decideSchoolRouteUse,
  isPublicPurpose,
  PUBLIC_PURPOSES,
  type ConsentMethod,
  type CurrentConsent,
  type Use,
} from "./public-use";

const never: CurrentConsent = { status: "never" };
const given = (method: ConsentMethod): CurrentConsent => ({
  status: "given",
  method,
});
const withdrawn = (method: ConsentMethod): CurrentConsent => ({
  status: "withdrawn",
  method,
});

const decide = (
  use: Use,
  institutionDeclared: boolean,
  consent: CurrentConsent
) => decideSchoolRouteUse({ use, institutionDeclared, consent });

describe("isPublicPurpose", () => {
  it("covers display, credit fields, social media and auction", () => {
    expect(PUBLIC_PURPOSES).toEqual([
      "public_display",
      "display_school",
      "display_city",
      "social_media",
      "auction",
    ]);
  });

  it("leaves out participation and communications", () => {
    expect(isPublicPurpose("participation")).toBe(false);
    expect(isPublicPurpose("communications")).toBe(false);
    expect(isPublicPurpose("judging")).toBe(false);
  });
});

describe("decideSchoolRouteUse: participation and judging", () => {
  it("are covered by the institution's declaration alone", () => {
    for (const use of ["participation", "judging"] as const) {
      expect(decide(use, true, never)).toEqual({
        allowed: true,
        basis: "institution_declaration",
      });
    }
  });

  it("need the declaration or a guardian's participation consent", () => {
    expect(decide("judging", false, never)).toEqual({
      allowed: false,
      reason: "no_declaration",
    });
    expect(decide("participation", false, given("otp_link"))).toEqual({
      allowed: true,
      basis: "code_link",
    });
    expect(decide("participation", false, given("staff_recorded"))).toEqual({
      allowed: false,
      reason: "no_declaration",
    });
  });

  it("stop when a guardian withdrew participation, declaration or not", () => {
    expect(decide("judging", true, withdrawn("web_form"))).toEqual({
      allowed: false,
      reason: "withdrawn",
    });
  });
});

describe("decideSchoolRouteUse: public uses", () => {
  it("never follow from the declaration alone", () => {
    for (const use of PUBLIC_PURPOSES) {
      expect(decide(use, true, never)).toEqual({
        allowed: false,
        reason: "no_guardian_consent",
      });
    }
  });

  it("follow a guardian's code link, accepted form or own account", () => {
    expect(decide("public_display", true, given("otp_link"))).toEqual({
      allowed: true,
      basis: "code_link",
    });
    expect(decide("social_media", false, given("paper_form"))).toEqual({
      allowed: true,
      basis: "signed_form",
    });
    expect(decide("auction", true, given("web_form"))).toEqual({
      allowed: true,
      basis: "web_form",
    });
  });

  it("refuse consent recorded by staff on someone's behalf", () => {
    expect(decide("public_display", true, given("staff_recorded"))).toEqual({
      allowed: false,
      reason: "method_not_accepted",
    });
  });

  it("stop once consent is withdrawn", () => {
    expect(decide("display_school", true, withdrawn("otp_link"))).toEqual({
      allowed: false,
      reason: "withdrawn",
    });
  });
});
