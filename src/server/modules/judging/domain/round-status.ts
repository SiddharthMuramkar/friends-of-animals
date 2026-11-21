// The life of an FOA judging round (#95). A competition manager sets a
// round up as a draft, opens it for judging, and may cancel it before it
// is locked. Every status is defined now, because a value added to a
// Postgres enum later can't be used in the same migration run; locking
// arrives with the rankings ticket, which adds `open -> locked` and its
// guard here.
//
// Loads under plain Node (schema file, seed script): relative imports only.

export const JUDGING_ROUND_STATUSES = [
  "draft",
  "open",
  "locked",
  "cancelled",
] as const;

export type JudgingRoundStatus = (typeof JUDGING_ROUND_STATUSES)[number];

/** The allowed moves. A status missing from a list is forbidden. */
const NEXT: Readonly<
  Record<JudgingRoundStatus, readonly JudgingRoundStatus[]>
> = {
  draft: ["open", "cancelled"],
  open: ["cancelled"],
  locked: [],
  cancelled: [],
};

/** Whether a round in status `from` may move to `to`. */
export function canMoveRound(
  from: JudgingRoundStatus,
  to: JudgingRoundStatus
): boolean {
  return NEXT[from].includes(to);
}

/** Only a draft's settings (name, level, award scheme, rules) change. */
export function isRoundEditable(status: JudgingRoundStatus): boolean {
  return status === "draft";
}

/**
 * Whether the round still takes judges, pool entries and assignments:
 * while it is being set up and while it is open, never once it is locked
 * or cancelled.
 */
export function acceptsJudges(status: JudgingRoundStatus): boolean {
  return status === "draft" || status === "open";
}
