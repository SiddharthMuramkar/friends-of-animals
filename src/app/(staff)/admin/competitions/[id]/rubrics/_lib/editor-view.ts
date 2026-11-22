// What the rubric editor shows: its rows, with any problems already
// translated, and an alert for the whole form. The page builds the first
// view from the draft; the save action returns the next one when it
// refuses, so nothing typed is lost.

import type { RubricCriterion } from "@/server/modules/judging/domain/rubric-criteria";
import { CRITERION_LIMITS } from "@/server/modules/judging/domain/rubric-criteria";

import {
  valuesOf,
  type CriterionField,
  type CriterionValues,
} from "./criteria-form";

export type EditorRow = {
  values: CriterionValues;
  errors: Partial<Record<CriterionField, string>>;
  /** An empty slot for a new criterion: no remove box. */
  blank: boolean;
};

export type RubricEditorView = {
  alert?: string;
  /** Extra lines under the alert, e.g. each publishing problem. */
  details?: string[];
  rows: EditorRow[];
  /** "Weights add up to …", for the rows as they stand. */
  total?: string;
};

/** Empty rows offered for new criteria, within the rubric's limit. */
const BLANK_ROWS = 2;

/** The rows to show: these, then up to two empty slots. */
export function editorRows(
  rows: readonly Omit<EditorRow, "blank">[]
): EditorRow[] {
  const blanks = Math.max(
    0,
    Math.min(BLANK_ROWS, CRITERION_LIMITS.maxCriteria - rows.length)
  );
  return [
    ...rows.map((row) => ({ ...row, blank: false })),
    ...Array.from({ length: blanks }, () => ({
      values: valuesOf({}),
      errors: {},
      blank: true,
    })),
  ];
}

/** The first view of a draft: its criteria, as the form shows them. */
export function draftView(
  criteria: readonly RubricCriterion[]
): RubricEditorView {
  return {
    rows: editorRows(
      criteria.map((criterion) => ({
        values: {
          label: criterion.label,
          description: criterion.description,
          weight: String(criterion.weight),
          minScore: String(criterion.minScore),
          maxScore: String(criterion.maxScore),
        },
        errors: {},
      }))
    ),
  };
}

/** The total of the weights typed so far, counting only whole numbers. */
export function weightTotal(rows: readonly EditorRow[]): number {
  return rows.reduce((sum, row) => {
    const weight = row.values.weight.trim();
    return /^\d{1,3}$/.test(weight) ? sum + Number(weight) : sum;
  }, 0);
}
