import { describe, expect, it } from "vitest";

import {
  MAX_CONFLICT_INSTITUTIONS,
  MAX_CONFLICT_STATEMENT_LENGTH,
  conflictDeclarationSchema,
} from "./conflict-declaration";

const SCHOOL_A = "01938a00-0000-7000-8000-00000000a001";
const SCHOOL_B = "01938a00-0000-7000-8000-00000000a002";

describe("a judge's conflict-of-interest declaration", () => {
  it("accepts an explicit 'no conflicts'", () => {
    expect(conflictDeclarationSchema.parse({ none: true })).toEqual({
      none: true,
    });
  });

  it("accepts institutions and a statement, trimmed", () => {
    expect(
      conflictDeclarationSchema.parse({
        none: false,
        institutionIds: [SCHOOL_A, SCHOOL_B],
        statement: "  My niece studies at a school in Pune.  ",
      })
    ).toEqual({
      none: false,
      institutionIds: [SCHOOL_A, SCHOOL_B],
      statement: "My niece studies at a school in Pune.",
    });
  });

  it("accepts institutions alone", () => {
    expect(
      conflictDeclarationSchema.parse({
        none: false,
        institutionIds: [SCHOOL_A],
      })
    ).toEqual({ none: false, institutionIds: [SCHOOL_A], statement: "" });
  });

  it("accepts a statement alone, for people staff turn into entry conflicts", () => {
    expect(
      conflictDeclarationSchema.parse({
        none: false,
        statement: "I coach two students privately.",
      })
    ).toEqual({
      none: false,
      institutionIds: [],
      statement: "I coach two students privately.",
    });
  });

  it("drops a repeated institution", () => {
    expect(
      conflictDeclarationSchema.parse({
        none: false,
        institutionIds: [SCHOOL_A, SCHOOL_A],
      })
    ).toMatchObject({ institutionIds: [SCHOOL_A] });
  });

  it.each([
    ["nothing at all", {}],
    ["conflicts with nothing declared", { none: false }],
    [
      "conflicts with only spaces",
      { none: false, institutionIds: [], statement: "   " },
    ],
    [
      "'no conflicts' that also lists an institution",
      { none: true, institutionIds: [SCHOOL_A] },
    ],
    [
      "an institution id that isn't a uuid",
      { none: false, institutionIds: ["x"] },
    ],
    [
      "too many institutions",
      {
        none: false,
        institutionIds: Array.from(
          { length: MAX_CONFLICT_INSTITUTIONS + 1 },
          (_, i) => `01938a00-0000-7000-8000-${String(i).padStart(12, "0")}`
        ),
      },
    ],
    [
      "a statement that is too long",
      {
        none: false,
        statement: "x".repeat(MAX_CONFLICT_STATEMENT_LENGTH + 1),
      },
    ],
  ])("refuses %s", (_, input) => {
    expect(conflictDeclarationSchema.safeParse(input).success).toBe(false);
  });
});
