import { describe, expect, it } from "vitest";

import {
  applyScoreSheetPatch,
  EMPTY_SCORE_SHEET,
  isSheetComplete,
  MAX_COMMENT_LENGTH,
  scoreSheetPatchSchema,
  scoringProgress,
  type ScoreSheet,
  type ScoreSheetPatch,
  type ScoringCriterion,
} from "./score-sheet";

const THEME = "01938a00-0000-7000-8000-00000000c001";
const CREATIVITY = "01938a00-0000-7000-8000-00000000c002";

const STARS = "01938a00-0000-7000-8000-00000000c003";

const RUBRIC: ScoringCriterion[] = [
  { id: THEME, minScore: 0, maxScore: 10 },
  { id: CREATIVITY, minScore: 0, maxScore: 10 },
];

/** Applies patches in order, as successive saves, and returns the sheet. */
function saved(...patches: ScoreSheetPatch[]): ScoreSheet {
  return patches.reduce((sheet, patch) => {
    const result = applyScoreSheetPatch(RUBRIC, sheet, patch);
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    return result.sheet;
  }, EMPTY_SCORE_SHEET);
}

describe("applyScoreSheetPatch", () => {
  it("saves a score on a new sheet and moves it to version 1", () => {
    const result = applyScoreSheetPatch(RUBRIC, EMPTY_SCORE_SHEET, {
      baseVersion: 0,
      scores: { [THEME]: 7 },
    });

    expect(result).toEqual<typeof result>({
      ok: true,
      changed: true,
      conflicts: [],
      sheet: {
        version: 1,
        scores: { [THEME]: { value: 7, changedAtVersion: 1 } },
        comment: { text: "", changedAtVersion: 0 },
      } satisfies ScoreSheet,
      progress: "in_progress",
    });
  });

  it("refuses a score above the criterion's range, below it, or with a fraction, and applies nothing", () => {
    const result = applyScoreSheetPatch(RUBRIC, EMPTY_SCORE_SHEET, {
      baseVersion: 0,
      scores: { [THEME]: 11, [CREATIVITY]: -1 },
    });
    expect(result).toEqual({
      ok: false,
      problems: [
        { code: "out_of_range", criterionId: THEME, min: 0, max: 10 },
        { code: "out_of_range", criterionId: CREATIVITY, min: 0, max: 10 },
      ],
    });
    expect(
      applyScoreSheetPatch(RUBRIC, EMPTY_SCORE_SHEET, {
        baseVersion: 0,
        scores: { [THEME]: 7.5, [CREATIVITY]: 6 },
      })
    ).toEqual({
      ok: false,
      problems: [{ code: "not_an_integer", criterionId: THEME }],
    });
  });

  it("accepts both ends of a criterion's range", () => {
    const rubric = [{ id: STARS, minScore: 1, maxScore: 5 }];
    for (const value of [1, 5]) {
      const result = applyScoreSheetPatch(rubric, EMPTY_SCORE_SHEET, {
        baseVersion: 0,
        scores: { [STARS]: value },
      });
      expect(result.ok).toBe(true);
    }
    expect(
      applyScoreSheetPatch(rubric, EMPTY_SCORE_SHEET, {
        baseVersion: 0,
        scores: { [STARS]: 0 },
      })
    ).toEqual({
      ok: false,
      problems: [{ code: "out_of_range", criterionId: STARS, min: 1, max: 5 }],
    });
  });

  it("refuses a criterion that isn't in the round's rubric", () => {
    expect(
      applyScoreSheetPatch(RUBRIC, EMPTY_SCORE_SHEET, {
        baseVersion: 0,
        scores: { [STARS]: 3 },
      })
    ).toEqual({
      ok: false,
      problems: [{ code: "unknown_criterion", criterionId: STARS }],
    });
  });

  it("refuses a comment over the limit and accepts one at it", () => {
    expect(MAX_COMMENT_LENGTH).toBe(2000);
    expect(
      applyScoreSheetPatch(RUBRIC, EMPTY_SCORE_SHEET, {
        baseVersion: 0,
        comment: "x".repeat(2001),
      })
    ).toEqual({
      ok: false,
      problems: [{ code: "comment_too_long", max: 2000 }],
    });
    expect(
      applyScoreSheetPatch(RUBRIC, EMPTY_SCORE_SHEET, {
        baseVersion: 0,
        comment: "x".repeat(2000),
      }).ok
    ).toBe(true);
  });

  it("refuses a patch based on a version the sheet hasn't reached", () => {
    expect(
      applyScoreSheetPatch(RUBRIC, EMPTY_SCORE_SHEET, {
        baseVersion: 3,
        scores: { [THEME]: 2 },
      })
    ).toEqual({
      ok: false,
      problems: [{ code: "base_version_ahead", version: 0 }],
    });
  });

  it("is complete once every criterion has a score, and not after one is cleared", () => {
    const partial = saved({ baseVersion: 0, scores: { [THEME]: 7 } });
    expect(isSheetComplete(RUBRIC, partial)).toBe(false);

    const full = applyScoreSheetPatch(RUBRIC, partial, {
      baseVersion: 1,
      scores: { [CREATIVITY]: 0 },
    });
    expect(full).toMatchObject({ ok: true, progress: "complete" });

    const cleared = applyScoreSheetPatch(
      RUBRIC,
      full.ok ? full.sheet : partial,
      { baseVersion: 2, scores: { [THEME]: null } }
    );
    expect(cleared).toMatchObject({
      ok: true,
      changed: true,
      progress: "in_progress",
      sheet: {
        version: 3,
        scores: {
          [THEME]: { value: null, changedAtVersion: 3 },
          [CREATIVITY]: { value: 0, changedAtVersion: 2 },
        },
      },
    });
  });

  it("keeps the version when a save changes nothing", () => {
    const sheet = saved({
      baseVersion: 0,
      scores: { [THEME]: 7 },
      comment: "Bold",
    });
    const again = applyScoreSheetPatch(RUBRIC, sheet, {
      baseVersion: 1,
      scores: { [THEME]: 7 },
      comment: "Bold",
    });
    expect(again).toEqual({
      ok: true,
      changed: false,
      conflicts: [],
      sheet,
      progress: "in_progress",
    });
  });

  it("lands two windows' edits to different criteria from the same base", () => {
    const base = saved({ baseVersion: 0, comment: "First look" });
    const fromWindowA = applyScoreSheetPatch(RUBRIC, base, {
      baseVersion: 1,
      scores: { [THEME]: 8 },
    });
    if (!fromWindowA.ok) throw new Error("window A refused");
    const fromWindowB = applyScoreSheetPatch(RUBRIC, fromWindowA.sheet, {
      baseVersion: 1,
      scores: { [CREATIVITY]: 6 },
    });

    expect(fromWindowB).toEqual({
      ok: true,
      changed: true,
      conflicts: [],
      progress: "complete",
      sheet: {
        version: 3,
        scores: {
          [THEME]: { value: 8, changedAtVersion: 2 },
          [CREATIVITY]: { value: 6, changedAtVersion: 3 },
        },
        comment: { text: "First look", changedAtVersion: 1 },
      },
    });
  });

  it("reports a criterion another window changed since the base, and still saves the rest", () => {
    const base = saved({ baseVersion: 0, scores: { [THEME]: 5 } });
    const newer = applyScoreSheetPatch(RUBRIC, base, {
      baseVersion: 1,
      scores: { [THEME]: 9 },
    });
    if (!newer.ok) throw new Error("newer save refused");

    const stale = applyScoreSheetPatch(RUBRIC, newer.sheet, {
      baseVersion: 1,
      scores: { [THEME]: 4, [CREATIVITY]: 6 },
    });

    expect(stale).toEqual({
      ok: true,
      changed: true,
      conflicts: [{ field: "score", criterionId: THEME, current: 9 }],
      progress: "complete",
      sheet: {
        version: 3,
        scores: {
          [THEME]: { value: 9, changedAtVersion: 2 },
          [CREATIVITY]: { value: 6, changedAtVersion: 3 },
        },
        comment: { text: "", changedAtVersion: 0 },
      },
    });
  });

  it("won't let a stale window put back a score another window cleared", () => {
    const base = saved(
      { baseVersion: 0, scores: { [THEME]: 5 } },
      { baseVersion: 1, scores: { [THEME]: null } }
    );
    const stale = applyScoreSheetPatch(RUBRIC, base, {
      baseVersion: 1,
      scores: { [THEME]: 6 },
    });
    expect(stale).toMatchObject({
      ok: true,
      changed: false,
      conflicts: [{ field: "score", criterionId: THEME, current: null }],
      sheet: { version: 2 },
    });
  });

  it("treats a stale save of the value already stored as no conflict", () => {
    const base = saved(
      { baseVersion: 0, scores: { [THEME]: 5 } },
      { baseVersion: 1, scores: { [THEME]: 9 } }
    );
    expect(
      applyScoreSheetPatch(RUBRIC, base, {
        baseVersion: 1,
        scores: { [THEME]: 9 },
      })
    ).toMatchObject({ ok: true, changed: false, conflicts: [] });
  });

  it("reports a comment another window changed since the base", () => {
    const base = saved(
      { baseVersion: 0, comment: "Good use of colour" },
      { baseVersion: 1, comment: "Good use of colour and light" }
    );
    expect(
      applyScoreSheetPatch(RUBRIC, base, { baseVersion: 1, comment: "Muddy" })
    ).toMatchObject({
      ok: true,
      changed: false,
      conflicts: [
        { field: "comment", current: "Good use of colour and light" },
      ],
    });
  });
});

describe("scoringProgress", () => {
  it("is not started with no sheet, or a sheet with nothing in it", () => {
    expect(scoringProgress(RUBRIC, undefined)).toBe("not_started");
    expect(scoringProgress(RUBRIC, EMPTY_SCORE_SHEET)).toBe("not_started");
    expect(
      scoringProgress(
        RUBRIC,
        saved(
          { baseVersion: 0, scores: { [THEME]: 3 } },
          { baseVersion: 1, scores: { [THEME]: null } }
        )
      )
    ).toBe("not_started");
  });

  it("is in progress with only a comment", () => {
    expect(
      scoringProgress(RUBRIC, saved({ baseVersion: 0, comment: "Lovely" }))
    ).toBe("in_progress");
  });

  it("is never complete against an empty rubric", () => {
    expect(scoringProgress([], EMPTY_SCORE_SHEET)).toBe("not_started");
    expect(isSheetComplete([], EMPTY_SCORE_SHEET)).toBe(false);
  });
});

describe("scoreSheetPatchSchema (what a save request may hold)", () => {
  it("keeps a fraction for the rubric check to refuse with the criterion named", () => {
    expect(
      scoreSheetPatchSchema.parse({ baseVersion: 2, scores: { [THEME]: 7.5 } })
    ).toEqual({ baseVersion: 2, scores: { [THEME]: 7.5 } });
  });

  it("refuses unknown fields, a negative or fractional base version and non-numbers", () => {
    for (const input of [
      { baseVersion: 0, extra: true },
      { baseVersion: -1 },
      { baseVersion: 1.5 },
      { baseVersion: 0, scores: { [THEME]: "7" } },
      { baseVersion: 0, scores: { [THEME]: Number.NaN } },
      { baseVersion: 0, scores: { [THEME]: Number.POSITIVE_INFINITY } },
    ]) {
      expect(scoreSheetPatchSchema.safeParse(input).success).toBe(false);
    }
  });
});
