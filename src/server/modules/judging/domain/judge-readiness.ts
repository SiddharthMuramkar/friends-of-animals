// The one gate in front of every judge-facing entry (#95): a judge may be
// assigned an entry, or shown one, only after accepting the round's
// invitation (so they hold the judge role scoped to that round), FOA's
// code of conduct and confidentiality terms, and declaring their
// conflicts of interest. Assignment and the blind scoring views both ask
// this, with facts loaded fresh, so removing the role counts at once.
//
// Pure: no database, no clock. Loads under plain Node (seed script).

/** The onboarding steps, in the order the judge takes them. */
export const ONBOARDING_STEPS = [
  "invitation",
  "conduct",
  "confidentiality",
  "conflicts",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** What is known about one judge in one round. */
export type JudgeOnboardingFacts = {
  /** Holds the judge role scoped to this round right now. */
  holdsRoundRole: boolean;
  conductAcceptedAt: Date | null;
  confidentialityAcceptedAt: Date | null;
  conflictsDeclaredAt: Date | null;
};

export type JudgeReadiness =
  | { ready: true }
  /** The steps still to take, in order. */
  | { ready: false; missing: OnboardingStep[] };

export function judgeReadiness(facts: JudgeOnboardingFacts): JudgeReadiness {
  const done: Record<OnboardingStep, boolean> = {
    invitation: facts.holdsRoundRole,
    conduct: facts.conductAcceptedAt !== null,
    confidentiality: facts.confidentialityAcceptedAt !== null,
    conflicts: facts.conflictsDeclaredAt !== null,
  };
  const missing = ONBOARDING_STEPS.filter((step) => !done[step]);
  return missing.length === 0 ? { ready: true } : { ready: false, missing };
}
