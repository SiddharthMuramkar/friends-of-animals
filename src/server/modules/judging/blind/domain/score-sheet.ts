// A judge's score sheet for one assigned entry: a whole-number score per
// rubric criterion and a free-text comment. The judge's browser saves it as
// they go, in patches that carry only what changed, so the judge can work
// over several sittings and in more than one window.
//
// Each criterion and the comment remember the sheet version that last
// changed them. A patch names the version it was based on: a field changed
// since then by another save is left alone and reported as a conflict, and
// every other field in the patch still lands. So two windows editing
// different criteria never lose each other's work, and neither silently
// overwrites a criterion the other changed.
//
// A sheet is complete when every criterion has a score; there is no separate
// submit. Rankings count complete sheets only.
//
// Loads under plain Node (seed script): relative imports only.

import { z } from "zod";

/** The part of a rubric criterion that scoring checks against. */
export type ScoringCriterion = {
  id: string;
  minScore: number;
  maxScore: number;
};

/**
 * A cleared score keeps its entry with `value: null` and the version that
 * cleared it, so a stale window can't quietly put the old score back.
 */
export type CriterionScore = { value: number | null; changedAtVersion: number };

export type ScoreSheet = {
  /** 0 until the first save changes something; +1 on every such save. */
  version: number;
  /** By criterion id. A criterion never scored has no entry. */
  scores: Readonly<Record<string, CriterionScore>>;
  comment: { text: string; changedAtVersion: number };
};

export const EMPTY_SCORE_SHEET: ScoreSheet = {
  version: 0,
  scores: {},
  comment: { text: "", changedAtVersion: 0 },
};

/** The longest comment a judge can leave. A default, not an FOA rule. */
export const MAX_COMMENT_LENGTH = 2000;

/**
 * What the browser sends. `null` clears a score. The comment is stored as
 * typed: trimming it while the judge types would fight their cursor.
 */
export const scoreSheetPatchSchema = z.strictObject({
  baseVersion: z.int().min(0),
  scores: z.record(z.string().min(1).max(64), z.number().nullable()).optional(),
  comment: z.string().optional(),
});

export type ScoreSheetPatch = z.infer<typeof scoreSheetPatchSchema>;

export type ScoreProblem =
  | { code: "unknown_criterion"; criterionId: string }
  | { code: "not_an_integer"; criterionId: string }
  | { code: "out_of_range"; criterionId: string; min: number; max: number }
  | { code: "comment_too_long"; max: number }
  | { code: "base_version_ahead"; version: number };

export type ScoreConflict =
  | { field: "score"; criterionId: string; current: number | null }
  | { field: "comment"; current: string };

export type ScoringProgress = "not_started" | "in_progress" | "complete";

export type PatchResult =
  /** Nothing was applied. */
  | { ok: false; problems: ScoreProblem[] }
  | {
      ok: true;
      sheet: ScoreSheet;
      /** False when every field already held the patched value. */
      changed: boolean;
      /** Fields left as stored because another save changed them first. */
      conflicts: ScoreConflict[];
      progress: ScoringProgress;
    };

/** Why these patched scores or comment can't be saved; empty if they can. */
export function scoreProblems(
  rubric: readonly ScoringCriterion[],
  patch: ScoreSheetPatch
): ScoreProblem[] {
  const byId = new Map(rubric.map((criterion) => [criterion.id, criterion]));
  const problems: ScoreProblem[] = [];
  for (const [criterionId, value] of Object.entries(patch.scores ?? {})) {
    const criterion = byId.get(criterionId);
    if (!criterion) {
      problems.push({ code: "unknown_criterion", criterionId });
    } else if (value === null) {
      continue;
    } else if (!Number.isInteger(value)) {
      problems.push({ code: "not_an_integer", criterionId });
    } else if (value < criterion.minScore || value > criterion.maxScore) {
      problems.push({
        code: "out_of_range",
        criterionId,
        min: criterion.minScore,
        max: criterion.maxScore,
      });
    }
  }
  if (
    patch.comment !== undefined &&
    patch.comment.length > MAX_COMMENT_LENGTH
  ) {
    problems.push({ code: "comment_too_long", max: MAX_COMMENT_LENGTH });
  }
  return problems;
}

/** Applies a patch: all of it, minus conflicting fields, or none of it. */
export function applyScoreSheetPatch(
  rubric: readonly ScoringCriterion[],
  sheet: ScoreSheet,
  patch: ScoreSheetPatch
): PatchResult {
  const problems = scoreProblems(rubric, patch);
  if (patch.baseVersion > sheet.version) {
    problems.push({ code: "base_version_ahead", version: sheet.version });
  }
  if (problems.length > 0) return { ok: false, problems };

  const nextVersion = sheet.version + 1;
  const scores: Record<string, CriterionScore> = { ...sheet.scores };
  let comment = sheet.comment;
  const conflicts: ScoreConflict[] = [];
  let changed = false;

  for (const [criterionId, value] of Object.entries(patch.scores ?? {})) {
    const stored = sheet.scores[criterionId];
    const current = stored?.value ?? null;
    if (value === current) continue;
    if (stored && stored.changedAtVersion > patch.baseVersion) {
      conflicts.push({ field: "score", criterionId, current });
      continue;
    }
    scores[criterionId] = { value, changedAtVersion: nextVersion };
    changed = true;
  }

  if (patch.comment !== undefined && patch.comment !== sheet.comment.text) {
    if (sheet.comment.changedAtVersion > patch.baseVersion) {
      conflicts.push({ field: "comment", current: sheet.comment.text });
    } else {
      comment = { text: patch.comment, changedAtVersion: nextVersion };
      changed = true;
    }
  }

  const next: ScoreSheet = changed
    ? { version: nextVersion, scores, comment }
    : sheet;
  return {
    ok: true,
    sheet: next,
    changed,
    conflicts,
    progress: scoringProgress(rubric, next),
  };
}

/** Whether every criterion of the rubric has a score. */
export function isSheetComplete(
  rubric: readonly ScoringCriterion[],
  sheet: ScoreSheet
): boolean {
  return (
    rubric.length > 0 &&
    rubric.every((criterion) => hasScore(sheet, criterion.id))
  );
}

/** Where the judge is with this entry, for the dashboard. */
export function scoringProgress(
  rubric: readonly ScoringCriterion[],
  sheet: ScoreSheet | undefined
): ScoringProgress {
  if (!sheet) return "not_started";
  if (isSheetComplete(rubric, sheet)) return "complete";
  const anyScore = rubric.some((criterion) => hasScore(sheet, criterion.id));
  return anyScore || sheet.comment.text !== "" ? "in_progress" : "not_started";
}

function hasScore(sheet: ScoreSheet, criterionId: string): boolean {
  const value = sheet.scores[criterionId]?.value;
  return value !== undefined && value !== null;
}
