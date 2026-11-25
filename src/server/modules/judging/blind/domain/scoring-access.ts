// Whether a judge may open or score one entry of a round. `can()` has
// already checked the round-scoped judge role; this decides from the facts
// about this judge, round and entry.
//
// An entry the judge isn't assigned, an entry of a round they can't see and
// a code that doesn't exist all get the same answer, so a judge can't learn
// which entry codes exist by trying them. A locked round stays readable, so
// judges can look back at what they gave, but no score changes after lock.
//
// Loads under plain Node (seed script): relative imports only.

export type JudgingRoundStatus = "draft" | "open" | "locked" | "cancelled";

export type ScoringFacts = {
  /** `null` when there is no such round. */
  roundStatus: JudgingRoundStatus | null;
  /** The judge accepted the conduct and confidentiality terms for it. */
  onboarded: boolean;
  /** The entry is assigned to this judge in this round. */
  assigned: boolean;
};

export type ScoringIntent = "read" | "write";

export type ScoringRefusal =
  | "entry_not_found"
  | "not_onboarded"
  | "round_locked";

export type ScoringDecision =
  | { ok: true }
  | { ok: false; code: ScoringRefusal };

const VISIBLE: readonly JudgingRoundStatus[] = ["open", "locked"];

export function decideScoringAccess(
  facts: ScoringFacts,
  intent: ScoringIntent
): ScoringDecision {
  if (facts.roundStatus === null || !VISIBLE.includes(facts.roundStatus)) {
    return { ok: false, code: "entry_not_found" };
  }
  if (!facts.onboarded) return { ok: false, code: "not_onboarded" };
  if (!facts.assigned) return { ok: false, code: "entry_not_found" };
  if (intent === "write" && facts.roundStatus !== "open") {
    return { ok: false, code: "round_locked" };
  }
  return { ok: true };
}
