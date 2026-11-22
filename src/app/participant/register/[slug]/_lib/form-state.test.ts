import { describe, expect, it } from "vitest";

import { afterResult, registered, START, valuesFrom } from "./form-state";

const typed = {
  ...START.values,
  fullName: "Asha Rao",
  dateOfBirth: "2012-03-03",
};

describe("the register form's state", () => {
  it("reads every field as typed, with each ticked document", () => {
    const form = new FormData();
    form.set("fullName", "Asha Rao");
    form.set("country", "IN");
    form.append("consents", "doc-1");
    form.append("consents", "doc-2");

    form.set("guardianEmail", "mum@example.test");

    expect(valuesFrom(form)).toEqual({
      ...START.values,
      fullName: "Asha Rao",
      country: "IN",
      guardianEmail: "mum@example.test",
      consents: ["doc-1", "doc-2"],
    });
  });

  it("marks the fields at fault in form order, keeping what was typed", () => {
    expect(
      afterResult(START, typed, {
        ok: false,
        error: "invalid_input",
        fields: ["consents", "pinCode", "fullName"],
      })
    ).toEqual({
      attempt: 1,
      values: typed,
      errors: ["fullName", "pinCode", "consents"],
      refusal: null,
      unexpected: false,
      askGuardian: false,
      destination: null,
    });
  });

  it("points a child under 13 at the date of birth", () => {
    expect(
      afterResult(START, typed, { ok: false, error: "under_13_needs_guardian" })
    ).toMatchObject({
      refusal: "under_13_needs_guardian",
      errors: ["dateOfBirth"],
      askGuardian: false,
    });
  });

  it("asks a teen on their own for their guardian, and keeps asking", () => {
    const asked = afterResult(START, typed, {
      ok: false,
      error: "guardian_details_required",
    });
    expect(asked).toMatchObject({
      refusal: "guardian_details_required",
      errors: [],
      askGuardian: true,
    });
    expect(
      afterResult(asked, typed, {
        ok: false,
        error: "invalid_input",
        fields: ["guardianEmail", "guardianName"],
      })
    ).toMatchObject({
      errors: ["guardianName", "guardianEmail"],
      askGuardian: true,
    });
    expect(
      afterResult(asked, typed, {
        ok: false,
        error: "guardian_contact_is_self",
      })
    ).toMatchObject({ errors: ["guardianEmail"], askGuardian: true });
  });

  it("shows a competition's own refusal above the form, marking no field", () => {
    expect(
      afterResult(START, typed, { ok: false, error: "already_registered" })
    ).toMatchObject({ refusal: "already_registered", errors: [] });
  });

  it("treats a bad competition slug as not found", () => {
    expect(
      afterResult(START, typed, {
        ok: false,
        error: "invalid_input",
        fields: ["competitionSlug"],
      })
    ).toMatchObject({ refusal: "not_found", errors: [] });
  });

  it("keeps what was typed when something unexpected fails", () => {
    expect(afterResult(START, typed, "unexpected")).toMatchObject({
      attempt: 1,
      values: typed,
      unexpected: true,
    });
  });

  it("hands a registered adult the page to load next, with nothing to fix", () => {
    const pay = "/participant/registrations/0b6e1d2c-reg/pay";
    expect(registered(START, typed, pay)).toEqual({
      attempt: 1,
      values: typed,
      errors: [],
      refusal: null,
      unexpected: false,
      askGuardian: false,
      destination: pay,
    });
  });
});
