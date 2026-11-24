import { describe, expect, it } from "vitest";

import { citiesOf, draftInput, formValues, refusedView } from "./form";

function formOf(entries: [string, string][]): FormData {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
}

describe("the campaign composer's form", () => {
  it("reads every choice of a criterion, and cities split on commas", () => {
    const values = formValues(
      formOf([
        ["subject", "Camp"],
        ["body", "Come along"],
        ["roles", "guardian"],
        ["roles", "volunteer"],
        ["cities", " Pune, , Navi Mumbai ,"],
      ])
    );
    expect(draftInput(values)).toEqual({
      subject: "Camp",
      body: "Come along",
      segment: {
        roles: ["guardian", "volunteer"],
        competitionIds: [],
        cities: ["Pune", "Navi Mumbai"],
      },
    });
    expect(citiesOf("")).toEqual([]);
  });

  it("marks the fields a refusal names, or says the form needs a look", () => {
    const values = formValues(formOf([]));
    expect(refusedView(values, { fields: ["subject", "segment"] })).toEqual({
      values,
      errors: ["subject", "segment"],
      alert: [],
    });
    expect(refusedView(values, { fields: ["id"] }).alert).toEqual([
      "invalid_input",
    ]);
    expect(refusedView(values, { code: "forbidden" })).toEqual({
      values,
      errors: [],
      alert: ["forbidden"],
    });
  });
});
