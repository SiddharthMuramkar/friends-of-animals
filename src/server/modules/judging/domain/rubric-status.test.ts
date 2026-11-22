import { describe, expect, it } from "vitest";

import {
  canMoveRubric,
  isRubricEditable,
  RUBRIC_STATUSES,
  type RubricStatus,
} from "./rubric-status";

const ALLOWED: ReadonlyArray<[RubricStatus, RubricStatus]> = [
  ["draft", "published"],
  ["published", "superseded"],
];

const EVERY_MOVE = RUBRIC_STATUSES.flatMap((from) =>
  RUBRIC_STATUSES.map((to) => [from, to] as const)
);

const FORBIDDEN = EVERY_MOVE.filter(
  ([from, to]) => !ALLOWED.some(([a, b]) => a === from && b === to)
);

describe("canMoveRubric()", () => {
  it("knows the three statuses a rubric can have", () => {
    expect(RUBRIC_STATUSES).toEqual(["draft", "published", "superseded"]);
  });

  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(canMoveRubric(from, to)).toBe(true);
  });

  it.each(FORBIDDEN)("refuses %s -> %s", (from, to) => {
    expect(canMoveRubric(from, to)).toBe(false);
  });

  it("covers every pair of statuses exactly once", () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(9);
    expect(FORBIDDEN).toContainEqual(["published", "draft"]);
    expect(FORBIDDEN).toContainEqual(["superseded", "published"]);
  });
});

describe("isRubricEditable()", () => {
  it("lets a manager edit only a draft", () => {
    expect(isRubricEditable("draft")).toBe(true);
    expect(isRubricEditable("published")).toBe(false);
    expect(isRubricEditable("superseded")).toBe(false);
  });
});
