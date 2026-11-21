import { describe, expect, it } from "vitest";

import {
  conflictSources,
  isConflicted,
  type EntryConflictFacts,
  type JudgeConflictFacts,
} from "./conflicts";

const SCHOOL_X = "school-x";
const SCHOOL_Y = "school-y";

const NO_TIES: JudgeConflictFacts = {
  declaredInstitutionIds: [],
  flaggedEntryIds: [],
  roleInstitutionIds: [],
  guardedProfileIds: [],
  ownProfileIds: [],
};

const ENTRY: EntryConflictFacts = {
  entryId: "entry-1",
  institutionId: SCHOOL_X,
  participantProfileId: "profile-1",
};

describe("conflicts between a judge and an entry", () => {
  it("finds none for a judge with no ties", () => {
    expect(conflictSources(NO_TIES, ENTRY)).toEqual([]);
    expect(isConflicted(NO_TIES, ENTRY)).toBe(false);
  });

  it.each([
    [
      "a declared institution",
      { declaredInstitutionIds: [SCHOOL_X] },
      "declared_institution",
    ],
    [
      "a staff flag on the entry",
      { flaggedEntryIds: ["entry-1"] },
      "staff_flag",
    ],
    [
      "a role at the entry's institution",
      { roleInstitutionIds: [SCHOOL_X] },
      "institution_role",
    ],
    [
      "being the participant's guardian",
      { guardedProfileIds: ["profile-1"] },
      "guardian",
    ],
    ["being the participant", { ownProfileIds: ["profile-1"] }, "own_entry"],
  ] as const)("finds %s", (_, ties, source) => {
    const judge = { ...NO_TIES, ...ties };
    expect(conflictSources(judge, ENTRY)).toEqual([source]);
    expect(isConflicted(judge, ENTRY)).toBe(true);
  });

  it("ignores ties to another institution, entry or participant", () => {
    const judge: JudgeConflictFacts = {
      declaredInstitutionIds: [SCHOOL_Y],
      flaggedEntryIds: ["entry-2"],
      roleInstitutionIds: [SCHOOL_Y],
      guardedProfileIds: ["profile-2"],
      ownProfileIds: ["profile-3"],
    };
    expect(isConflicted(judge, ENTRY)).toBe(false);
  });

  it("never matches institution ties to an individual entry", () => {
    const individual = { ...ENTRY, institutionId: null };
    const judge = {
      ...NO_TIES,
      declaredInstitutionIds: [SCHOOL_X],
      roleInstitutionIds: [SCHOOL_X],
    };
    expect(isConflicted(judge, individual)).toBe(false);
  });

  it("lists every source that applies, in a fixed order", () => {
    const judge: JudgeConflictFacts = {
      declaredInstitutionIds: [SCHOOL_X],
      flaggedEntryIds: ["entry-1"],
      roleInstitutionIds: [SCHOOL_X],
      guardedProfileIds: ["profile-1"],
      ownProfileIds: ["profile-1"],
    };
    expect(conflictSources(judge, ENTRY)).toEqual([
      "declared_institution",
      "staff_flag",
      "institution_role",
      "guardian",
      "own_entry",
    ]);
  });
});
