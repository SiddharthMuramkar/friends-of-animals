// The engagement ladder: the milestones a person reaches with FOA. Pure:
// the schema builds its pgEnum from the tuple below, and the module's write
// seam checks every milestone here before it touches the database.
//
// Every rung is declared now, because adding an enum value later and using
// it in the same migration run fails. Results publishing feeds the first
// three (through the certificates it issues); joining the community feeds
// the fourth; volunteering (#123) and ambassadors (#122) the last two.

import { subjectKey, type Subject } from "./subject";

/** Every rung, in ladder order. */
export const MILESTONE_KINDS = [
  "participant",
  "school_winner",
  "foa_finalist",
  "community_member",
  "volunteer",
  "ambassador",
] as const;

export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

/** Rungs reached once per competition; the rest once per person. */
const PER_COMPETITION: ReadonlySet<MilestoneKind> = new Set<MilestoneKind>([
  "participant",
  "school_winner",
  "foa_finalist",
]);

/** Whether `kind` is reached once per competition (else once per person). */
export function isPerCompetition(kind: MilestoneKind): boolean {
  return PER_COMPETITION.has(kind);
}

/** One milestone: who reached which rung, in which competition if any. */
export type MilestoneIdentity = {
  subject: Subject;
  kind: MilestoneKind;
  /** Set for per-competition rungs, null for the others. */
  competitionId: string | null;
};

/** Thrown when a milestone names a competition it can't have, or lacks one. */
export class MilestoneScopeError extends Error {
  readonly kind: MilestoneKind;

  constructor(kind: MilestoneKind, competitionId: string | null) {
    super(
      competitionId === null
        ? `A ${kind} milestone needs a competition`
        : `A ${kind} milestone is once per person and takes no competition`
    );
    this.name = "MilestoneScopeError";
    this.kind = kind;
  }
}

/**
 * Checks that the milestone's scope fits its rung and returns it.
 * Throws `MilestoneScopeError` otherwise.
 */
export function milestoneIdentity(
  milestone: MilestoneIdentity
): MilestoneIdentity {
  const { kind, competitionId } = milestone;
  if (isPerCompetition(kind) !== (competitionId !== null)) {
    throw new MilestoneScopeError(kind, competitionId);
  }
  return {
    subject: milestone.subject,
    kind,
    competitionId,
  };
}

/**
 * The idempotency key of the milestone's timeline entry. It names the
 * milestone, not the event that produced it, so the live consumer, a
 * replayed event and the backfill all write one entry.
 */
export function milestoneSourceKey(milestone: MilestoneIdentity): string {
  const { subject, kind, competitionId } = milestoneIdentity(milestone);
  return `milestone:${kind}:${subjectKey(subject)}:${competitionId ?? "-"}`;
}

/**
 * The results rung a certificate stands for (#100's certificate types), or
 * null for a certificate that isn't one: volunteer service (#124) or a type
 * this module doesn't know. Every finalist, runner-up and winner is an FOA
 * finalist; a school position is a school win.
 */
export function milestoneForCertificateType(
  type: string
): MilestoneKind | null {
  switch (type) {
    case "participation":
      return "participant";
    case "school_merit":
      return "school_winner";
    case "finalist":
    case "runner_up":
    case "winner":
      return "foa_finalist";
    default:
      return null;
  }
}
