import { describe, expect, it } from "vitest";

import {
  afterResult,
  EMPTY_LISTING,
  startWith,
  valuesFrom,
} from "./listing-form-state";

describe("the listing form's state", () => {
  it("reads every field, and both lists of checkboxes, from the form", () => {
    const form = new FormData();
    form.set("type", "shelter");
    form.set("name", "Safe Paws");
    form.append("services", "shelter");
    form.append("services", "adoption");
    form.append("publicContactFields", "phone");
    form.set("unexpected", "ignored");

    expect(valuesFrom(form)).toEqual({
      ...EMPTY_LISTING,
      type: "shelter",
      name: "Safe Paws",
      services: ["shelter", "adoption"],
      publicContactFields: ["phone"],
    });
  });

  it("keeps what was typed and marks only the form's fields", () => {
    const values = { ...EMPTY_LISTING, name: "X" };
    expect(
      afterResult(startWith(EMPTY_LISTING), values, {
        ok: false,
        error: "invalid_input",
        fields: ["name", "listingId"],
      })
    ).toEqual({
      attempt: 1,
      values,
      errors: ["name"],
      alert: "invalid_input",
    });
    expect(
      afterResult(startWith(EMPTY_LISTING), values, "unexpected")
    ).toMatchObject({ attempt: 1, alert: "unexpected", errors: [] });
  });
});
