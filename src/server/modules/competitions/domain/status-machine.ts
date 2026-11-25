// The competition status machine (#71): which statuses exist, and who may
// move a competition from one to the next. The schedule makes every move
// after publishing; nobody opens or closes registration by hand. A super
// admin may cancel a competition from any status (#80), and nothing leaves
// cancelled. Later tickets append statuses (FOA judging, results) and
// their rows here, keeping cancelled last; once results are published a
// competition can't be cancelled.
//
// Plain TypeScript with no imports, so the schema file and the seed script
// can load it under plain Node.

/** Every status, in the order a competition passes through them. */
export const COMPETITION_STATUSES = [
  "draft",
  "published",
  "registration_open",
  "registration_closed",
  "school_judging",
  /**
   * FOA verifies and judges what the schools sent on (#90 makes the move,
   * at the shortlist deadline, once every school round is finished).
   */
  "foa_judging",
  /** Called off by a super admin (#80): every paid fee goes back. Final. */
  "cancelled",
] as const;

export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

/**
 * Who makes a move: a competition manager through a use case, the
 * schedule (the worker, acting as the system) when a key date arrives, or
 * a cancellation (a super admin behind step-up, #80).
 */
export type TransitionCause = "manager" | "schedule" | "cancellation";

/**
 * The allowed moves, each with the one cause that may make it. A pair that
 * is missing is forbidden for everyone.
 */
const TRANSITIONS: {
  readonly [From in CompetitionStatus]: Partial<
    Record<CompetitionStatus, TransitionCause>
  >;
} = {
  draft: { published: "manager", cancelled: "cancellation" },
  published: { registration_open: "schedule", cancelled: "cancellation" },
  registration_open: {
    registration_closed: "schedule",
    cancelled: "cancellation",
  },
  // Guarded (#88): every enabled discipline needs a published rubric
  // first. The guards run where the move is made (../transition-guards.ts).
  registration_closed: {
    school_judging: "schedule",
    cancelled: "cancellation",
  },
  // Guarded (#90): no school round may be unfinished.
  school_judging: { foa_judging: "schedule", cancelled: "cancellation" },
  foa_judging: { cancelled: "cancellation" },
  cancelled: {},
};

/** Who may move a competition from `from` to `to`, or null if nobody may. */
export function transitionCause(
  from: CompetitionStatus,
  to: CompetitionStatus
): TransitionCause | null {
  return TRANSITIONS[from][to] ?? null;
}

/** Whether `by` may move a competition from `from` to `to`. */
export function canTransition(
  from: CompetitionStatus,
  to: CompetitionStatus,
  by: TransitionCause
): boolean {
  return transitionCause(from, to) === by;
}
