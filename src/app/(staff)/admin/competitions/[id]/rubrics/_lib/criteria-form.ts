// The rubric editor's rows, read into criteria. Each row is
// `criteria.<n>.<field>`; `rows` says how many were sent. A blank row (an
// unused slot) and a row ticked "remove" are left out. Every field at
// fault is named, row by row, with the bounds the rubric itself keeps, so
// the form can say what to fix and keep what was typed.

import {
  CRITERION_LIMITS,
  type RubricCriterion,
} from "@/server/modules/judging/domain/rubric-criteria";

export const CRITERION_FIELDS = [
  "label",
  "description",
  "weight",
  "minScore",
  "maxScore",
] as const;

export type CriterionField = (typeof CRITERION_FIELDS)[number];

export type CriterionValues = Record<CriterionField, string>;

export type CriterionProblem =
  | "required"
  | "too_long"
  | "duplicate"
  | "whole_number"
  | "out_of_range"
  | "range_order";

export type CriterionRow = {
  values: CriterionValues;
  errors: Partial<Record<CriterionField, CriterionProblem>>;
};

export type ParsedCriteriaForm =
  | { ok: true; criteria: RubricCriterion[] }
  | { ok: false; rows: CriterionRow[]; tooMany?: true };

/** More rows than this are never read, whatever `rows` says. */
export const MAX_ROWS = 20;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** A row's raw values, for a form to show again. */
export function valuesOf(
  row: Partial<Record<CriterionField, string>>
): CriterionValues {
  return {
    label: row.label ?? "",
    description: row.description ?? "",
    weight: row.weight ?? "",
    minScore: row.minScore ?? "",
    maxScore: row.maxScore ?? "",
  };
}

/** A whole number written in digits, or null. */
function wholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return /^-?\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
}

function readRows(form: FormData): CriterionValues[] {
  const count = Math.min(Number(text(form, "rows")) || 0, MAX_ROWS);
  const rows: CriterionValues[] = [];
  for (let index = 0; index < count; index++) {
    const field = (name: string) => text(form, `criteria.${index}.${name}`);
    if (field("remove") !== "") continue;
    const values = valuesOf(
      Object.fromEntries(CRITERION_FIELDS.map((name) => [name, field(name)]))
    );
    if (Object.values(values).every((value) => value.trim() === "")) continue;
    rows.push(values);
  }
  return rows;
}

function checkNumber(
  raw: string,
  range: { min: number; max: number }
): { value: number } | { problem: CriterionProblem } {
  const value = wholeNumber(raw);
  if (value === null) return { problem: "whole_number" };
  if (value < range.min || value > range.max)
    return { problem: "out_of_range" };
  return { value };
}

export function parseCriteriaForm(form: FormData): ParsedCriteriaForm {
  const rows = readRows(form);
  const seen = new Set<string>();
  const criteria: RubricCriterion[] = [];
  const checked: CriterionRow[] = rows.map((values) => {
    const errors: CriterionRow["errors"] = {};
    const label = values.label.trim();
    const description = values.description.trim();
    if (label === "") errors.label = "required";
    else if (label.length > CRITERION_LIMITS.labelLength) {
      errors.label = "too_long";
    } else if (seen.has(label.toLowerCase())) errors.label = "duplicate";
    seen.add(label.toLowerCase());
    if (description.length > CRITERION_LIMITS.descriptionLength) {
      errors.description = "too_long";
    }
    const weight = checkNumber(values.weight, CRITERION_LIMITS.weight);
    const minScore = checkNumber(values.minScore, CRITERION_LIMITS.score);
    const maxScore = checkNumber(values.maxScore, CRITERION_LIMITS.score);
    if ("problem" in weight) errors.weight = weight.problem;
    if ("problem" in minScore) errors.minScore = minScore.problem;
    if ("problem" in maxScore) errors.maxScore = maxScore.problem;
    if ("value" in minScore && "value" in maxScore) {
      if (minScore.value >= maxScore.value) errors.maxScore = "range_order";
      else if ("value" in weight && Object.keys(errors).length === 0) {
        criteria.push({
          label,
          description,
          weight: weight.value,
          minScore: minScore.value,
          maxScore: maxScore.value,
        });
      }
    }
    return { values, errors };
  });

  const tooMany = rows.length > CRITERION_LIMITS.maxCriteria;
  if (tooMany || checked.some((row) => Object.keys(row.errors).length > 0)) {
    return tooMany
      ? { ok: false, rows: checked, tooMany: true }
      : { ok: false, rows: checked };
  }
  return { ok: true, criteria };
}
