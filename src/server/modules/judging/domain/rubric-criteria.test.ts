import { describe, expect, it } from "vitest";

import {
  defaultRubricCriteria,
  publishProblems,
  rubricCriteriaSchema,
  type RubricCriterion,
} from "./rubric-criteria";

const criterion = (
  overrides: Partial<RubricCriterion> = {}
): RubricCriterion => ({
  label: "Technique",
  description: "",
  weight: 25,
  minScore: 0,
  maxScore: 10,
  ...overrides,
});

/** The issue paths zod reports, as dotted strings. */
function problemPaths(input: unknown): string[] {
  const result = rubricCriteriaSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join("."));
}

describe("rubricCriteriaSchema (what a saved draft may hold)", () => {
  it("accepts a criterion and trims its text", () => {
    expect(
      rubricCriteriaSchema.parse([
        criterion({ label: "  Theme  ", description: " Fits the theme " }),
      ])
    ).toEqual([criterion({ label: "Theme", description: "Fits the theme" })]);
  });

  it("fills in an empty description", () => {
    const { description: _omitted, ...withoutDescription } = criterion();
    expect(rubricCriteriaSchema.parse([withoutDescription])).toEqual([
      criterion(),
    ]);
  });

  it("lets a draft be saved with no criteria or weights that don't add up yet", () => {
    expect(rubricCriteriaSchema.parse([])).toEqual([]);
    expect(problemPaths([criterion({ weight: 40 })])).toEqual([]);
  });

  it("needs a label of at most 120 characters", () => {
    expect(problemPaths([criterion({ label: "   " })])).toEqual(["0.label"]);
    expect(problemPaths([criterion({ label: "x".repeat(121) })])).toEqual([
      "0.label",
    ]);
  });

  it("caps a description at 600 characters", () => {
    expect(problemPaths([criterion({ description: "x".repeat(601) })])).toEqual(
      ["0.description"]
    );
  });

  it("needs a whole-number weight from 1 to 100", () => {
    expect(problemPaths([criterion({ weight: 0 })])).toEqual(["0.weight"]);
    expect(problemPaths([criterion({ weight: 101 })])).toEqual(["0.weight"]);
    expect(problemPaths([criterion({ weight: 12.5 })])).toEqual(["0.weight"]);
  });

  it("needs whole-number scores from 0 to 100", () => {
    expect(problemPaths([criterion({ minScore: -1 })])).toEqual(["0.minScore"]);
    expect(problemPaths([criterion({ maxScore: 101 })])).toEqual([
      "0.maxScore",
    ]);
    expect(problemPaths([criterion({ maxScore: 7.5 })])).toEqual([
      "0.maxScore",
    ]);
  });

  it("needs the top score above the bottom score", () => {
    expect(problemPaths([criterion({ minScore: 5, maxScore: 5 })])).toEqual([
      "0.maxScore",
    ]);
    expect(problemPaths([criterion({ minScore: 1, maxScore: 5 })])).toEqual([]);
  });

  it("refuses two criteria with the same label, ignoring case and spaces", () => {
    expect(
      problemPaths([
        criterion({ label: "Technique" }),
        criterion({ label: "Theme" }),
        criterion({ label: " technique " }),
      ])
    ).toEqual(["2.label"]);
  });

  it("holds at most 10 criteria", () => {
    const criteria = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        criterion({ label: `Criterion ${index + 1}`, weight: 10 })
      );
    expect(problemPaths(criteria(10))).toEqual([]);
    expect(problemPaths(criteria(11))).toEqual([""]);
  });

  it("refuses fields it doesn't know", () => {
    expect(problemPaths([{ ...criterion(), points: 3 }])).toEqual(["0"]);
  });
});

describe("publishProblems() (what stops a draft from being published)", () => {
  it("finds nothing wrong with criteria whose weights total 100", () => {
    expect(
      publishProblems([
        criterion({ label: "Theme", weight: 30 }),
        criterion({ label: "Creativity", weight: 25 }),
        criterion({ label: "Technique", weight: 25 }),
        criterion({ label: "Presentation", weight: 20 }),
      ])
    ).toEqual([]);
  });

  it("needs at least one criterion", () => {
    expect(publishProblems([])).toEqual([{ code: "no_criteria" }]);
  });

  it("reports the total when the weights don't add up to 100", () => {
    expect(
      publishProblems([
        criterion({ label: "Theme", weight: 30 }),
        criterion({ label: "Technique", weight: 25 }),
      ])
    ).toEqual([{ code: "weights_total", total: 55 }]);
    expect(
      publishProblems([
        criterion({ label: "Theme", weight: 60 }),
        criterion({ label: "Technique", weight: 50 }),
      ])
    ).toEqual([{ code: "weights_total", total: 110 }]);
  });
});

describe("defaultRubricCriteria() (what a new draft starts with)", () => {
  it("starts from the judging guide on the public site, scored 0 to 10", () => {
    expect(defaultRubricCriteria()).toEqual([
      criterion({ label: "Theme and message", weight: 30 }),
      criterion({ label: "Creativity and originality", weight: 25 }),
      criterion({ label: "Technique", weight: 25 }),
      criterion({ label: "Presentation and effort", weight: 20 }),
    ]);
  });

  it("is a valid draft that can be published as it is", () => {
    const criteria = defaultRubricCriteria();
    expect(rubricCriteriaSchema.parse(criteria)).toEqual(criteria);
    expect(publishProblems(criteria)).toEqual([]);
  });

  it("returns a fresh copy each time, so editing one draft changes no other", () => {
    const first = defaultRubricCriteria();
    first[0]!.weight = 1;
    expect(defaultRubricCriteria()[0]!.weight).toBe(30);
  });
});
