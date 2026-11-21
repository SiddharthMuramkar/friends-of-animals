import { describe, expect, it } from "vitest";

import {
  everyCategory,
  publishProblems,
  type PublishCandidate,
} from "./publish-rules";

const ready: PublishCandidate = {
  name: "Neighbours on My Street",
  theme: "An animal that shares your street.",
  welfareMessage: "Every street animal is a neighbour.",
  rules: "One entry per discipline.",
  permittedMaterials: "Paper, pencils, paints.",
  duration: "90 minutes, in one sitting",
  participation: "both",
  disciplines: ["drawing", "painting"],
  ageGroups: [
    { label: "Group A", minAge: 5, maxAge: 8 },
    { label: "Group B", minAge: 9, maxAge: 12 },
  ],
  categories: everyCategory(["drawing", "painting"], ["Group A", "Group B"]),
  ageCutoffDate: "2027-01-01",
  shortlistPerCategory: 5,
  schoolPositions: 3,
  physicalArtwork: { kind: "all_shortlisted" },
  keyDates: {
    registration_opens: new Date("2027-01-01T03:30:00Z"),
    registration_closes: new Date("2027-01-31T18:29:00Z"),
    submissions_close: new Date("2027-02-15T18:29:00Z"),
    school_round_closes: new Date("2027-02-28T18:29:00Z"),
  },
};

describe("publishProblems()", () => {
  it("finds nothing wrong with a complete competition", () => {
    expect(publishProblems(ready)).toEqual([]);
  });

  it("needs every text a participant reads before registering", () => {
    const blank = {
      ...ready,
      name: " ",
      theme: null,
      welfareMessage: "",
      rules: null,
      permittedMaterials: "\n",
      duration: null,
    };
    expect(publishProblems(blank)).toEqual([
      { field: "name", code: "required" },
      { field: "theme", code: "required" },
      { field: "welfareMessage", code: "required" },
      { field: "rules", code: "required" },
      { field: "permittedMaterials", code: "required" },
      { field: "duration", code: "required" },
    ]);
  });

  it("needs participation, a discipline and an age cut-off date", () => {
    const missing = {
      ...ready,
      participation: null,
      disciplines: [],
      categories: [],
      ageCutoffDate: null,
    };
    expect(publishProblems(missing)).toEqual(
      expect.arrayContaining([
        { field: "participation", code: "required" },
        { field: "disciplines", code: "required" },
        { field: "ageCutoffDate", code: "required" },
      ])
    );
  });

  it("refuses an age cut-off date that doesn't exist", () => {
    expect(publishProblems({ ...ready, ageCutoffDate: "2027-02-30" })).toEqual([
      { field: "ageCutoffDate", code: "invalid" },
    ]);
  });

  it("passes on age group problems with their index", () => {
    const ageGroups = [
      { label: "Group A", minAge: 5, maxAge: 9 },
      { label: "Group B", minAge: 9, maxAge: 12 },
    ];
    expect(publishProblems({ ...ready, ageGroups })).toEqual([
      { field: "ageGroups", code: "overlaps", index: 1, other: 0 },
    ]);
  });

  it("needs at least one category", () => {
    expect(publishProblems({ ...ready, categories: [] })).toEqual([
      { field: "categories", code: "required" },
    ]);
  });

  it("refuses a category whose discipline or age group isn't in the competition", () => {
    const categories = [
      ...ready.categories,
      { discipline: "essay", ageGroup: "Group A" },
      { discipline: "drawing", ageGroup: "Group Z" },
    ] as const;
    expect(publishProblems({ ...ready, categories: [...categories] })).toEqual([
      { field: "categories", code: "unknown_discipline", index: 4 },
      { field: "categories", code: "unknown_age_group", index: 5 },
    ]);
  });

  it("needs a positive shortlist size when institutions take part", () => {
    expect(publishProblems({ ...ready, shortlistPerCategory: 0 })).toEqual([
      { field: "shortlistPerCategory", code: "out_of_range" },
    ]);
    expect(publishProblems({ ...ready, schoolPositions: -1 })).toEqual([
      { field: "schoolPositions", code: "out_of_range" },
    ]);
  });

  it("ignores the school shortlist settings when only individuals take part", () => {
    const { school_round_closes: _, ...keyDates } = ready.keyDates;
    expect(
      publishProblems({
        ...ready,
        participation: "individuals",
        shortlistPerCategory: 0,
        schoolPositions: 0,
        keyDates,
      })
    ).toEqual([]);
  });

  it("needs a top-N physical artwork count within the shortlist size", () => {
    for (const count of [0, 6, 2.5]) {
      expect(
        publishProblems({ ...ready, physicalArtwork: { kind: "top_n", count } })
      ).toEqual([{ field: "physicalArtwork", code: "out_of_range" }]);
    }
    expect(
      publishProblems({
        ...ready,
        physicalArtwork: { kind: "top_n", count: 5 },
      })
    ).toEqual([]);
  });

  it("passes on key date problems", () => {
    const { submissions_close: _, ...keyDates } = ready.keyDates;
    expect(publishProblems({ ...ready, keyDates })).toEqual([
      { field: "keyDates", code: "required", kind: "submissions_close" },
    ]);
  });
});

describe("everyCategory()", () => {
  it("crosses every discipline with every age group", () => {
    expect(everyCategory(["drawing", "essay"], ["A", "B"])).toEqual([
      { discipline: "drawing", ageGroup: "A" },
      { discipline: "drawing", ageGroup: "B" },
      { discipline: "essay", ageGroup: "A" },
      { discipline: "essay", ageGroup: "B" },
    ]);
  });
});
