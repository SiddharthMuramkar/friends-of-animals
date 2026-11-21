import { describe, expect, it } from "vitest";

import { ageGroupProblems } from "./age-groups";

describe("ageGroupProblems()", () => {
  it("accepts separate, labelled groups", () => {
    expect(
      ageGroupProblems([
        { label: "Group A", minAge: 5, maxAge: 8 },
        { label: "Group B", minAge: 9, maxAge: 12 },
        { label: "Adults", minAge: 18, maxAge: 99 },
      ])
    ).toEqual([]);
  });

  it("needs at least one group", () => {
    expect(ageGroupProblems([])).toEqual([{ code: "none" }]);
  });

  it("needs a label on every group", () => {
    expect(ageGroupProblems([{ label: "  ", minAge: 5, maxAge: 8 }])).toEqual([
      { index: 0, code: "label_required" },
    ]);
  });

  it("refuses two groups with the same label, ignoring case and spaces", () => {
    expect(
      ageGroupProblems([
        { label: "Juniors", minAge: 5, maxAge: 8 },
        { label: " juniors ", minAge: 9, maxAge: 12 },
      ])
    ).toEqual([{ index: 1, code: "label_duplicate", other: 0 }]);
  });

  it("refuses a group whose youngest age is above its oldest", () => {
    expect(
      ageGroupProblems([{ label: "Group A", minAge: 9, maxAge: 8 }])
    ).toEqual([{ index: 0, code: "range_inverted" }]);
  });

  it("refuses ages outside whole years from 3 to 99", () => {
    for (const [minAge, maxAge] of [
      [2, 8],
      [5, 100],
      [5.5, 8],
    ] as const) {
      expect(ageGroupProblems([{ label: "Group A", minAge, maxAge }])).toEqual([
        { index: 0, code: "age_out_of_bounds" },
      ]);
    }
  });

  it("refuses groups that share an age, so each child fits one group", () => {
    expect(
      ageGroupProblems([
        { label: "Group A", minAge: 5, maxAge: 9 },
        { label: "Group B", minAge: 9, maxAge: 12 },
      ])
    ).toEqual([{ index: 1, code: "overlaps", other: 0 }]);
  });
});
