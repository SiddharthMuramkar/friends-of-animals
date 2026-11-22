import { describe, expect, it } from "vitest";

import { problemMessage, refusalOutcome } from "./form-view";

describe("refusalOutcome", () => {
  it("marks each field a save refused, under one alert", () => {
    expect(
      refusalOutcome({
        ok: false,
        error: "invalid_input",
        fields: ["name", "ageGroups", "shortlistPerCategory"],
      })
    ).toEqual({
      alert: "invalid_input",
      errors: {
        name: [{ key: "errors.name" }],
        ageGroups: [{ key: "errors.ageGroups" }],
        shortlistPerCategory: [{ key: "errors.number" }],
      },
    });
  });

  it("puts code refusals on the code field", () => {
    expect(refusalOutcome({ ok: false, error: "code_taken" })).toEqual({
      alert: "code_taken",
      errors: { code: [{ key: "errors.codeTaken" }] },
    });
    expect(refusalOutcome({ ok: false, error: "invalid_code" })).toEqual({
      alert: "invalid_code",
      errors: { code: [{ key: "errors.codeFormat" }] },
    });
    expect(refusalOutcome({ ok: false, error: "code_locked" })).toEqual({
      alert: "code_locked",
      errors: { code: [{ key: "errors.codeLocked" }] },
    });
  });

  it("puts a date that never existed on its own input", () => {
    expect(
      refusalOutcome({
        ok: false,
        error: "invalid_date",
        fields: ["ageCutoffDate", "keyDates.submissions_close"],
      })
    ).toEqual({
      alert: "invalid_date",
      errors: {
        ageCutoffDate: [{ key: "errors.date" }],
        "keyDates.submissions_close": [{ key: "errors.date" }],
      },
    });
  });

  it("lists a published competition's gaps against their fields", () => {
    expect(
      refusalOutcome({
        ok: false,
        error: "not_ready",
        problems: [
          { field: "rules", code: "required" },
          { field: "ageGroups", code: "overlaps", index: 1, other: 0 },
          { field: "ageGroups", code: "range_inverted", index: 0 },
        ],
      })
    ).toEqual({
      alert: "not_ready",
      errors: {
        rules: [{ key: "problems.required", labels: { field: "form.rules" } }],
        ageGroups: [
          { key: "problems.overlaps", values: { row: 2, other: 1 } },
          { key: "problems.range_inverted", values: { row: 1 } },
        ],
      },
    });
  });

  it("says not found with no field to mark", () => {
    expect(refusalOutcome({ ok: false, error: "not_found" })).toEqual({
      alert: "not_found",
      errors: {},
    });
  });
});

describe("problemMessage", () => {
  it.each([
    [
      { field: "theme", code: "required" },
      "theme",
      { key: "problems.required", labels: { field: "form.theme" } },
    ],
    [
      { field: "ageCutoffDate", code: "invalid" },
      "ageCutoffDate",
      { key: "problems.dateInvalid", labels: { field: "form.ageCutoffDate" } },
    ],
    [
      { field: "ageGroups", code: "none" },
      "ageGroups",
      { key: "problems.ageGroupsNone" },
    ],
    [
      { field: "categories", code: "unknown_age_group", index: 2 },
      "categories",
      { key: "problems.unknown_age_group", values: { row: 3 } },
    ],
    [
      { field: "physicalArtwork", code: "out_of_range" },
      "physicalArtwork",
      {
        key: "problems.out_of_range",
        labels: { field: "form.physicalArtworkTopN" },
      },
    ],
    [
      { field: "keyDates", code: "required", kind: "registration_opens" },
      "keyDates.registration_opens",
      {
        key: "problems.keyDateRequired",
        labels: { kind: "vocabulary.keyDate.registration_opens" },
      },
    ],
    [
      {
        field: "keyDates",
        code: "must_follow",
        kind: "registration_closes",
        other: "registration_opens",
      },
      "keyDates.registration_closes",
      {
        key: "problems.keyDateMustFollow",
        labels: {
          kind: "vocabulary.keyDate.registration_closes",
          other: "vocabulary.keyDate.registration_opens",
        },
      },
    ],
    [
      {
        field: "keyDates",
        code: "must_follow",
        kind: "submissions_close",
        other: "registration_closes",
      },
      "keyDates.submissions_close",
      {
        key: "problems.keyDateNotBefore",
        labels: {
          kind: "vocabulary.keyDate.submissions_close",
          other: "vocabulary.keyDate.registration_closes",
        },
      },
    ],
  ] as const)("words %j against its field", (problem, field, message) => {
    expect(problemMessage(problem)).toEqual({ field, message });
  });
});
