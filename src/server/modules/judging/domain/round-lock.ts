// Locking an FOA round, and what each round status allows. A round locks
// only when every judge assignment is scored (every criterion has a value,
// ./ranking.ts `isSheetComplete`). A staff admin can lock it anyway with a
// written reason, which the use case audit-logs with the unscored
// assignments. Once locked, scores never change and outcomes can be tagged.
//
// The statuses come from the FOA rounds ticket (draft, open, locked,
// cancelled); it owns draft -> open and the cancellations. Who may lock or
// override is `can()`'s decision, not this file's.
//
// Loads under plain Node: relative imports only.

export const ROUND_STATUSES = ["draft", "open", "locked", "cancelled"] as const;

export type RoundStatus = (typeof ROUND_STATUSES)[number];

export const ROUND_ACTIONS = [
  "score",
  "viewRankings",
  "lock",
  "overrideLock",
  "tagOutcomes",
] as const;

export type RoundAction = (typeof ROUND_ACTIONS)[number];

const ALLOWED_IN: Record<RoundAction, readonly RoundStatus[]> = {
  score: ["open"],
  viewRankings: ["open", "locked"],
  lock: ["open"],
  overrideLock: ["open"],
  tagOutcomes: ["locked"],
};

/** Whether a round in `status` allows `action`. */
export function roundAllows(status: RoundStatus, action: RoundAction): boolean {
  return ALLOWED_IN[action].includes(status);
}

/** Length of an override reason after trimming (default, HR-40). */
export const OVERRIDE_REASON_LIMITS = { min: 10, max: 500 } as const;

export type LockRequest = {
  status: RoundStatus;
  /** Every judge assignment in the round, scored or not. */
  assignments: readonly { assignmentId: string; scored: boolean }[];
  /** Present when a staff admin locks despite unscored assignments. */
  override?: { reason: string };
};

export type LockDecision =
  | { ok: true; to: "locked"; mode: "complete" }
  | {
      ok: true;
      to: "locked";
      mode: "override";
      /** Trimmed, for the audit log. */
      reason: string;
      unscoredAssignmentIds: string[];
    }
  | { ok: false; code: "round_not_open"; status: RoundStatus }
  /** A count only: the refusal never names entries or participants. */
  | { ok: false; code: "unscored_assignments"; unscoredCount: number }
  | { ok: false; code: "no_assignments" }
  | { ok: false; code: "override_reason_invalid" };

/**
 * Whether the round may lock now, and how. An override offered when
 * nothing is unscored is ignored: the lock is simply complete.
 */
export function decideRoundLock(request: LockRequest): LockDecision {
  const { status, assignments, override } = request;
  if (!roundAllows(status, "lock")) {
    return { ok: false, code: "round_not_open", status };
  }
  const unscored = assignments
    .filter((assignment) => !assignment.scored)
    .map((assignment) => assignment.assignmentId)
    .sort();
  const complete = assignments.length > 0 && unscored.length === 0;
  if (complete) return { ok: true, to: "locked", mode: "complete" };
  if (!override) {
    return assignments.length === 0
      ? { ok: false, code: "no_assignments" }
      : {
          ok: false,
          code: "unscored_assignments",
          unscoredCount: unscored.length,
        };
  }
  const reason = override.reason.trim();
  if (
    reason.length < OVERRIDE_REASON_LIMITS.min ||
    reason.length > OVERRIDE_REASON_LIMITS.max
  ) {
    return { ok: false, code: "override_reason_invalid" };
  }
  return {
    ok: true,
    to: "locked",
    mode: "override",
    reason,
    unscoredAssignmentIds: unscored,
  };
}
