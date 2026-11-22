import { describe, expect, it } from "vitest";

import { parseCriteriaForm, valuesOf } from "./criteria-form";

type Row = Partial<
  Record<
    "label" | "description" | "weight" | "minScore" | "maxScore" | "remove",
    string
  >
>;

function form(rows: Row[]): FormData {
  const data = new FormData();
  data.set("rows", String(rows.length));
  rows.forEach((row, index) => {
    for (const [name, value] of Object.entries(row)) {
      data.set(`criteria.${index}.${name}`, value);
    }
  });
  return data;
}

const THEME: Row = {
  label: " Theme ",
  description: "Fits the theme",
  weight: "60",
  minScore: "0",
  maxScore: "10",
};
const SKILL: Row = {
  label: "Skill",
  description: "",
  weight: "40",
  minScore: "1",
  maxScore: "5",
};

describe("parseCriteriaForm", () => {
  it("reads the rows in order, trimmed, as whole numbers", () => {
    expect(parseCriteriaForm(form([THEME, SKILL]))).toEqual({
      ok: true,
      criteria: [
        {
          label: "Theme",
          description: "Fits the theme",
          weight: 60,
          minScore: 0,
          maxScore: 10,
        },
        {
          label: "Skill",
          description: "",
          weight: 40,
          minScore: 1,
          maxScore: 5,
        },
      ],
    });
  });

  it("leaves out blank rows and rows ticked for removal", () => {
    expect(
      parseCriteriaForm(
        form([
          { ...THEME, remove: "on" },
          {
            label: " ",
            description: "",
            weight: "",
            minScore: "",
            maxScore: "",
          },
          SKILL,
        ])
      )
    ).toMatchObject({ ok: true, criteria: [{ label: "Skill" }] });
  });

  it("gives no criteria at all for an empty form", () => {
    expect(parseCriteriaForm(form([]))).toEqual({ ok: true, criteria: [] });
  });

  it("names each field at fault, row by row, and keeps what was typed", () => {
    const result = parseCriteriaForm(
      form([
        { ...THEME, weight: "sixty" },
        { ...SKILL, label: "", minScore: "5", maxScore: "5" },
        { ...SKILL, label: "theme", weight: "0" },
      ])
    );

    expect(result).toEqual({
      ok: false,
      rows: [
        {
          values: { ...valuesOf(THEME), weight: "sixty" },
          errors: { weight: "whole_number" },
        },
        {
          values: {
            ...valuesOf(SKILL),
            label: "",
            minScore: "5",
            maxScore: "5",
          },
          errors: { label: "required", maxScore: "range_order" },
        },
        {
          values: { ...valuesOf(SKILL), label: "theme", weight: "0" },
          errors: { label: "duplicate", weight: "out_of_range" },
        },
      ],
    });
  });

  it("refuses more criteria than a rubric holds", () => {
    const result = parseCriteriaForm(
      form(
        Array.from({ length: 11 }, (_, index) => ({
          ...SKILL,
          label: `Part ${index + 1}`,
        }))
      )
    );

    expect(result).toMatchObject({ ok: false, tooMany: true });
  });
});
