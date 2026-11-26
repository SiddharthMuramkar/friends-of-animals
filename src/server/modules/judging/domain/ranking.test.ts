import { describe, expect, it } from "vitest";

import { formatRational, rational } from "./rational";
import {
  isSheetComplete,
  rankEntries,
  sheetTotal,
  TIE_BREAK_RULE,
  type RankingEntry,
  type ScoringCriterion,
} from "./ranking";

// The public judging guide's rubric (src/content/judging.ts), scored 0-10.
const RUBRIC: readonly ScoringCriterion[] = [
  { id: "theme", weight: 30, minScore: 0, maxScore: 10 },
  { id: "creativity", weight: 25, minScore: 0, maxScore: 10 },
  { id: "technique", weight: 25, minScore: 0, maxScore: 10 },
  { id: "presentation", weight: 20, minScore: 0, maxScore: 10 },
];

/** One judge's sheet, scores in rubric order. */
function sheet(judgeId: string, ...values: (number | undefined)[]) {
  return {
    judgeId,
    scores: Object.fromEntries(
      RUBRIC.map((criterion, index) => [criterion.id, values[index]])
    ),
  };
}

// Hand-computed. With weights totalling 100 and every range 0-10, a sheet
// total is sum(weight x score) / 10:
//   A: 81.0, 80.0, 87.5        mean 82.83  rank 1
//   B: 69.0, 70.5, 70.5        mean 70.00  rank 2  theme mean 8.33
//   C: 70.0, 71.5, 68.5        mean 70.00  rank 3  theme mean 7, median 70
//   D: 71.5, 68.5, 70.0        mean 70.00  rank 3  same means and median
// B, C and D tie on score. B beats both on the highest-weight criterion
// (theme). C and D match on every criterion and on the median, so they
// share rank 3.
const FIXTURE: readonly RankingEntry[] = [
  {
    entryId: "entry-a",
    sheets: [
      sheet("j1", 9, 8, 8, 7),
      sheet("j2", 8, 9, 7, 8),
      sheet("j3", 9, 9, 8, 9),
    ],
  },
  {
    entryId: "entry-b",
    sheets: [
      sheet("j1", 9, 6, 6, 6),
      sheet("j2", 8, 7, 6, 7),
      sheet("j3", 8, 6, 7, 7),
    ],
  },
  {
    entryId: "entry-c",
    sheets: [
      sheet("j1", 7, 7, 7, 7),
      sheet("j2", 6, 8, 7, 8),
      sheet("j3", 8, 6, 7, 6),
    ],
  },
  {
    entryId: "entry-d",
    sheets: [
      sheet("j1", 6, 8, 7, 8),
      sheet("j2", 8, 6, 7, 6),
      sheet("j3", 7, 7, 7, 7),
    ],
  },
];

describe("sheetTotal()", () => {
  it("weights each criterion's share of its range, out of 100", () => {
    expect(sheetTotal(RUBRIC, sheet("j1", 9, 8, 8, 7))).toEqual(rational(81));
    expect(sheetTotal(RUBRIC, sheet("j3", 9, 9, 8, 9))).toEqual(
      rational(175, 2)
    );
  });

  it("normalises criteria with different ranges", () => {
    const mixed: ScoringCriterion[] = [
      { id: "idea", weight: 60, minScore: 0, maxScore: 10 },
      { id: "finish", weight: 40, minScore: 1, maxScore: 5 },
    ];
    expect(
      sheetTotal(mixed, { judgeId: "j1", scores: { idea: 5, finish: 3 } })
    ).toEqual(rational(50));
    expect(
      sheetTotal(mixed, { judgeId: "j1", scores: { idea: 10, finish: 1 } })
    ).toEqual(rational(60));
  });

  it("has no total for an unfinished sheet", () => {
    expect(sheetTotal(RUBRIC, sheet("j1", 9, 8, 8))).toBeNull();
  });
});

describe("isSheetComplete()", () => {
  it("counts a sheet as scored once every criterion has a value", () => {
    expect(isSheetComplete(RUBRIC, sheet("j1", 0, 0, 0, 0))).toBe(true);
    expect(isSheetComplete(RUBRIC, sheet("j1", 9, 8, 8))).toBe(false);
    expect(isSheetComplete(RUBRIC, { judgeId: "j1", scores: {} })).toBe(false);
  });

  it("refuses scores the rubric can't hold instead of ranking on them", () => {
    expect(() => isSheetComplete(RUBRIC, sheet("j1", 11, 8, 8, 7))).toThrow(
      RangeError
    );
    expect(() => isSheetComplete(RUBRIC, sheet("j1", 7.5, 8, 8, 7))).toThrow(
      RangeError
    );
    expect(() =>
      isSheetComplete(RUBRIC, {
        judgeId: "j1",
        scores: { ...sheet("j1", 1, 1, 1, 1).scores, colour: 5 },
      })
    ).toThrow(/colour/);
  });
});

describe("rankEntries()", () => {
  it("matches the hand-computed fixture, ties included", () => {
    const { ranked, unscored } = rankEntries(RUBRIC, FIXTURE);
    expect(
      ranked.map((entry) => ({
        entryId: entry.entryId,
        score: formatRational(entry.score),
        rank: entry.rank,
        decidedBy: entry.decidedBy,
      }))
    ).toEqual([
      { entryId: "entry-a", score: "82.83", rank: 1, decidedBy: null },
      { entryId: "entry-b", score: "70.00", rank: 2, decidedBy: "score" },
      {
        entryId: "entry-c",
        score: "70.00",
        rank: 3,
        decidedBy: { criterionId: "theme" },
      },
      { entryId: "entry-d", score: "70.00", rank: 3, decidedBy: "shared" },
    ]);
    expect(ranked[0]?.score).toEqual(rational(497, 6));
    expect(unscored).toEqual([]);
  });

  it("gives the same result whatever order entries and sheets come in", () => {
    const shuffled = [...FIXTURE].reverse().map((entry) => ({
      ...entry,
      sheets: [...entry.sheets].reverse(),
    }));
    expect(rankEntries(RUBRIC, shuffled)).toEqual(rankEntries(RUBRIC, FIXTURE));
  });

  it("goes down the criteria by weight, rubric order breaking equal weights", () => {
    // Equal totals and theme; creativity (25) comes before technique (25).
    const { ranked } = rankEntries(RUBRIC, [
      { entryId: "q", sheets: [sheet("j1", 7, 6, 8, 5)] },
      { entryId: "p", sheets: [sheet("j1", 7, 8, 6, 5)] },
    ]);
    expect(ranked.map((entry) => [entry.entryId, entry.rank])).toEqual([
      ["p", 1],
      ["q", 2],
    ]);
    expect(ranked[1]?.decidedBy).toEqual({ criterionId: "creativity" });
  });

  it("falls back to the higher median sheet total", () => {
    const single: ScoringCriterion[] = [
      { id: "overall", weight: 100, minScore: 0, maxScore: 10 },
    ];
    const scores = (judge: string, value: number) => ({
      judgeId: judge,
      scores: { overall: value },
    });
    // Both average 60 on the one criterion; medians 50 and 70.
    const { ranked } = rankEntries(single, [
      {
        entryId: "x",
        sheets: [scores("j1", 5), scores("j2", 5), scores("j3", 8)],
      },
      {
        entryId: "y",
        sheets: [scores("j1", 4), scores("j2", 7), scores("j3", 7)],
      },
    ]);
    expect(ranked.map((entry) => entry.entryId)).toEqual(["y", "x"]);
    expect(ranked[1]?.decidedBy).toBe("median");
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  it("skips ranks after a shared one (1, 2, 2, 4)", () => {
    const single: ScoringCriterion[] = [
      { id: "overall", weight: 100, minScore: 0, maxScore: 10 },
    ];
    const entry = (entryId: string, value: number) => ({
      entryId,
      sheets: [{ judgeId: "j1", scores: { overall: value } }],
    });
    const { ranked } = rankEntries(single, [
      entry("w", 7),
      entry("x", 8),
      entry("y", 9),
      entry("z", 8),
    ]);
    expect(ranked.map((row) => [row.entryId, row.rank])).toEqual([
      ["y", 1],
      ["x", 2],
      ["z", 2],
      ["w", 4],
    ]);
  });

  it("averages only finished sheets and lists entries with none as unscored", () => {
    const { ranked, unscored } = rankEntries(RUBRIC, [
      {
        entryId: "entry-a",
        sheets: [
          sheet("j1", 9, 8, 8, 7),
          sheet("j2", 8, 9, 7, 8),
          sheet("j4", 1, 1, 1),
        ],
      },
      { entryId: "entry-e", sheets: [sheet("j1", 5, 5)] },
      { entryId: "entry-f", sheets: [] },
    ]);
    expect(ranked).toHaveLength(1);
    expect(formatRational(ranked[0]!.score)).toBe("80.50");
    expect(ranked[0]?.sheetsCounted).toBe(2);
    expect(unscored).toEqual(["entry-e", "entry-f"]);
  });

  it("needs a rubric with criteria", () => {
    expect(() => rankEntries([], FIXTURE)).toThrow(RangeError);
  });

  it("names the stated rule so a round can record it", () => {
    expect(TIE_BREAK_RULE).toBe(
      "criteria-by-weight-then-median-then-shared-v1"
    );
  });
});
