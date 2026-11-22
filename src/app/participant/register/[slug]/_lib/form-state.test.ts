import { describe, expect, it } from "vitest";

import { afterResult, START, valuesFrom } from "./form-state";

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

    expect(valuesFrom(form)).toEqual({
      ...START.values,
      fullName: "Asha Rao",
      country: "IN",
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
    });
  });

  it("points a minor at the date of birth with the come-back message", () => {
    expect(
      afterResult(START, typed, { ok: false, error: "minor" })
    ).toMatchObject({
      refusal: "minor",
      errors: ["dateOfBirth"],
    });
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
});
