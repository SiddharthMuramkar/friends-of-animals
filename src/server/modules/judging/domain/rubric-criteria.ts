// What a rubric holds: its criteria, each with a label, an optional
// description, a weight and a score range. A draft may be saved half
// finished; publishing needs criteria whose weights total 100.
//
// Defaults to confirm with FOA (HR-37): weights must total 100, and a new
// criterion is scored 0 to 10.
//
// Loads under plain Node (seed script): relative imports only.

import { z } from "zod";

import showcaseMessages from "../../../../../messages/en-IN/showcase.json";
import { RUBRIC } from "../../../../content/judging";

/** The total a published rubric's weights must reach. */
export const TOTAL_WEIGHT = 100;

/** The score range a new criterion starts with. */
export const DEFAULT_SCORE_RANGE = { minScore: 0, maxScore: 10 } as const;

/** The bounds a rubric's criteria keep; the admin form checks the same. */
export const CRITERION_LIMITS = {
  maxCriteria: 10,
  labelLength: 120,
  descriptionLength: 600,
  weight: { min: 1, max: 100 },
  score: { min: 0, max: 100 },
} as const;

const { weight, score: scoreRange } = CRITERION_LIMITS;

const score = z.int().min(scoreRange.min).max(scoreRange.max);

const rubricCriterionSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(CRITERION_LIMITS.labelLength),
    description: z
      .string()
      .trim()
      .max(CRITERION_LIMITS.descriptionLength)
      .default(""),
    weight: z.int().min(weight.min).max(weight.max),
    minScore: score,
    maxScore: score,
  })
  .refine((criterion) => criterion.minScore < criterion.maxScore, {
    path: ["maxScore"],
    message: "The top score must be above the bottom score",
  });

export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;

/** A draft's criteria, in display order. */
export const rubricCriteriaSchema = z
  .array(rubricCriterionSchema)
  .max(CRITERION_LIMITS.maxCriteria)
  .superRefine((criteria, ctx) => {
    const seen = new Set<string>();
    criteria.forEach((criterion, index) => {
      const label = criterion.label.toLowerCase();
      if (seen.has(label)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "label"],
          message: "Two criteria have the same label",
        });
      }
      seen.add(label);
    });
  });

export type RubricProblem =
  | { code: "no_criteria" }
  | { code: "weights_total"; total: number };

/** Why a draft with these criteria can't be published; empty if it can. */
export function publishProblems(
  criteria: readonly RubricCriterion[]
): RubricProblem[] {
  if (criteria.length === 0) return [{ code: "no_criteria" }];
  const total = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  return total === TOTAL_WEIGHT ? [] : [{ code: "weights_total", total }];
}

/**
 * The criteria a new draft starts with: the judging guide the public site
 * shows (labels from its copy, weights from src/content/judging.ts).
 */
export function defaultRubricCriteria(): RubricCriterion[] {
  const labels = showcaseMessages.showcase.judging.rubric;
  return RUBRIC.map(({ key, weight }) => ({
    label: labels[key],
    description: "",
    weight,
    ...DEFAULT_SCORE_RANGE,
  }));
}
