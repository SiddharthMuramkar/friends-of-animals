import type {
  ScoreConflict,
  ScoreSheet,
  ScoreSheetPatch,
  ScoringCriterion,
} from "@/server/modules/judging/blind/domain/score-sheet";
export type Draft = { scores: Record<string, string>; comment: string };
export function draftFromSheet(
  criteria: readonly ScoringCriterion[],
  sheet: ScoreSheet
): Draft {
  return {
    scores: Object.fromEntries(
      criteria.map((c) => [c.id, sheet.scores[c.id]?.value?.toString() ?? ""])
    ),
    comment: sheet.comment.text,
  };
}
export function dirty(draft: Draft, saved: Draft) {
  return (
    draft.comment !== saved.comment ||
    Object.keys(draft.scores).some(
      (id) => draft.scores[id] !== saved.scores[id]
    )
  );
}
export function patchFromDraft(
  criteria: readonly ScoringCriterion[],
  draft: Draft,
  sheet: ScoreSheet
): ScoreSheetPatch | null {
  const stored = draftFromSheet(criteria, sheet);
  const scores: Record<string, number | null> = {};
  for (const criterion of criteria) {
    const raw = draft.scores[criterion.id] ?? "";
    if (raw === stored.scores[criterion.id]) continue;
    const value = raw === "" ? null : Number(raw);
    if (
      value !== null &&
      (!/^\d+$/.test(raw) ||
        !Number.isInteger(value) ||
        value < criterion.minScore ||
        value > criterion.maxScore)
    )
      return null;
    scores[criterion.id] = value;
  }
  return {
    baseVersion: sheet.version,
    scores,
    ...(draft.comment !== stored.comment ? { comment: draft.comment } : {}),
  };
}
/** Apply a server response only to local fields the judge hasn't edited
 * since sending the patch. Keep conflicted fields until the judge chooses. */
export function mergedDraft(
  criteria: readonly ScoringCriterion[],
  current: Draft,
  sent: Draft,
  sheet: ScoreSheet,
  conflicts: readonly ScoreConflict[]
): Draft {
  const stored = draftFromSheet(criteria, sheet);
  const blocked = new Set(
    conflicts.flatMap((c) => (c.field === "score" ? [c.criterionId] : []))
  );
  return {
    scores: Object.fromEntries(
      criteria.map((c) => [
        c.id,
        current.scores[c.id] !== sent.scores[c.id] || blocked.has(c.id)
          ? (current.scores[c.id] ?? "")
          : (stored.scores[c.id] ?? ""),
      ])
    ),
    comment:
      current.comment !== sent.comment ||
      conflicts.some((c) => c.field === "comment")
        ? current.comment
        : stored.comment,
  };
}
