import { describe, expect, it } from "vitest";

import { refusedFormState, secondStepRedirect } from "./form-state";

describe("refusedFormState", () => {
  it("keeps what was typed beside why the save was refused", () => {
    const typed = {
      subject: "Welcome aboard",
      body: "Hello {{recipient.name}}, welcome.",
      dltTemplateId: "",
    };
    const why = "Only content managers and super admins can edit templates.";

    expect(refusedFormState({ version: 3 }, typed, why)).toEqual({
      status: "refused",
      version: 3,
      fieldErrors: {},
      values: typed,
      message: why,
    });
  });
});

describe("secondStepRedirect", () => {
  it("sends a save refused for want of a second step to lift it, then back to the template", () => {
    const back = "next=%2Fadmin%2Ftemplates%2Fidentity.welcome";
    expect(
      secondStepRedirect("second_factor_required", "identity.welcome")
    ).toBe(`/auth/second-factor?${back}`);
    expect(secondStepRedirect("step_up_required", "identity.welcome")).toBe(
      `/auth/step-up?${back}`
    );
    expect(secondStepRedirect("enrolment_required", "identity.welcome")).toBe(
      `/account/security?${back}`
    );
  });

  it("leaves a refusal no second step can lift to the form", () => {
    expect(secondStepRedirect("forbidden", "identity.welcome")).toBeNull();
  });
});
