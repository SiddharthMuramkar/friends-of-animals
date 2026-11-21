// Age groups put children against their peers. Ages are whole years on the
// competition's cut-off date, so groups must not share an age: each date of
// birth then falls into at most one group.

export type AgeGroupInput = { label: string; minAge: number; maxAge: number };

/** Youngest and oldest ages a group may name. */
export const AGE_BOUNDS = { min: 3, max: 99 } as const;

export type AgeGroupProblem =
  | { code: "none" }
  | {
      index: number;
      code: "label_required" | "range_inverted" | "age_out_of_bounds";
    }
  | { index: number; code: "label_duplicate" | "overlaps"; other: number };

const labelKey = (label: string) => label.trim().toLowerCase();

const inBounds = (age: number) =>
  Number.isInteger(age) && age >= AGE_BOUNDS.min && age <= AGE_BOUNDS.max;

/** What is wrong with these groups, at most one problem per group. */
export function ageGroupProblems(
  groups: readonly AgeGroupInput[]
): AgeGroupProblem[] {
  if (groups.length === 0) return [{ code: "none" }];
  const problems: AgeGroupProblem[] = [];
  groups.forEach((group, index) => {
    const earlier = groups.slice(0, index);
    if (labelKey(group.label) === "") {
      problems.push({ index, code: "label_required" });
      return;
    }
    const sameLabel = earlier.findIndex(
      (g) => labelKey(g.label) === labelKey(group.label)
    );
    if (sameLabel !== -1) {
      problems.push({ index, code: "label_duplicate", other: sameLabel });
      return;
    }
    if (!inBounds(group.minAge) || !inBounds(group.maxAge)) {
      problems.push({ index, code: "age_out_of_bounds" });
      return;
    }
    if (group.minAge > group.maxAge) {
      problems.push({ index, code: "range_inverted" });
      return;
    }
    const overlapping = earlier.findIndex(
      (g) => g.minAge <= group.maxAge && group.minAge <= g.maxAge
    );
    if (overlapping !== -1)
      problems.push({ index, code: "overlaps", other: overlapping });
  });
  return problems;
}
