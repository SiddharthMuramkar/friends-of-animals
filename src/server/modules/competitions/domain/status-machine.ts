// The competition status machine (#71): which statuses exist, and who may
// move a competition from one to the next. The schedule makes every move
// after publishing; nobody opens or closes registration by hand. Later
// tickets append statuses (school judging, FOA judging, cancelled) and
// their rows here.
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
] as const;

export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

/**
 * Who makes a move: a competition manager through a use case, or the
 * schedule (the worker, acting as the system) when a key date arrives.
 */
export type TransitionCause = "manager" | "schedule";

/**
 * The allowed moves, each with the one cause that may make it. A pair that
 * is missing is forbidden for everyone.
 */
const TRANSITIONS: {
  readonly [From in CompetitionStatus]: Partial<
    Record<CompetitionStatus, TransitionCause>
  >;
} = {
  draft: { published: "manager" },
  published: { registration_open: "schedule" },
  registration_open: { registration_closed: "schedule" },
  registration_closed: {},
  school_judging: {},
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
