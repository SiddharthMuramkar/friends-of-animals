// The life of a rubric. A competition manager edits a draft; publishing
// freezes it; publishing a newer version for the same discipline supersedes
// it. A published or superseded rubric is never edited again, only replaced
// by a new version.
//
// Loads under plain Node (seed script): relative imports only.

export const RUBRIC_STATUSES = ["draft", "published", "superseded"] as const;

export type RubricStatus = (typeof RUBRIC_STATUSES)[number];

const NEXT: Record<RubricStatus, readonly RubricStatus[]> = {
  draft: ["published"],
  published: ["superseded"],
  superseded: [],
};

/** Whether a rubric in status `from` may move to `to`. */
export function canMoveRubric(from: RubricStatus, to: RubricStatus): boolean {
  return NEXT[from].includes(to);
}

/** Only a draft's criteria may change. */
export function isRubricEditable(status: RubricStatus): boolean {
  return status === "draft";
}
