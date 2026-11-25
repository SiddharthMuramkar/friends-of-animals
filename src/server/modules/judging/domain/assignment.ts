// Whether one entry may be assigned to one judge in a round (#95). Reasons
// are checked in a fixed order, round first, then judge, then entry, so a
// refusal never says more than it must: an entry outside the pool is
// "not_in_pool" even if the judge would also conflict with it, and a
// conflict is never hidden behind "already_assigned".
//
// Pure: the caller loads the facts. Loads under plain Node (seed script).

export type AssignmentFacts = {
  /** The round is a draft or open, not locked or cancelled. */
  roundAcceptsJudges: boolean;
  /** The judge passes the onboarding gate for this round. */
  judgeReady: boolean;
  /** The entry is in this round's pool. */
  inPool: boolean;
  conflicted: boolean;
  alreadyAssigned: boolean;
};

export type AssignmentRefusal =
  | "round_closed"
  | "judge_not_ready"
  | "not_in_pool"
  | "conflict"
  | "already_assigned";

export type AssignmentDecision =
  | { ok: true }
  | { ok: false; reason: AssignmentRefusal };

export function decideAssignment(facts: AssignmentFacts): AssignmentDecision {
  if (!facts.roundAcceptsJudges) return { ok: false, reason: "round_closed" };
  if (!facts.judgeReady) return { ok: false, reason: "judge_not_ready" };
  if (!facts.inPool) return { ok: false, reason: "not_in_pool" };
  if (facts.conflicted) return { ok: false, reason: "conflict" };
  if (facts.alreadyAssigned) return { ok: false, reason: "already_assigned" };
  return { ok: true };
}
