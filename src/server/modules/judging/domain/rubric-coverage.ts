// The school-judging guard's rule: a competition may enter school judging
// only once every discipline it enables has a published rubric. Drafts and
// superseded versions don't count.
//
// Loads under plain Node (seed script): relative imports only.

import type { RubricStatus } from "./rubric-status";

export type RubricCoverage<Discipline extends string> =
  | { complete: true }
  /** `missing` keeps the order of the enabled disciplines. */
  | { complete: false; missing: Discipline[] };

export function rubricCoverage<Discipline extends string>(
  enabled: readonly Discipline[],
  rubrics: readonly { discipline: Discipline; status: RubricStatus }[]
): RubricCoverage<Discipline> {
  const published = new Set(
    rubrics
      .filter((rubric) => rubric.status === "published")
      .map((rubric) => rubric.discipline)
  );
  const missing = [...new Set(enabled)].filter(
    (discipline) => !published.has(discipline)
  );
  return missing.length === 0
    ? { complete: true }
    : { complete: false, missing };
}
