// The school round's status machine. Pure: no imports, so the schema file
// (which loads under plain Node) can build its pgEnum from the tuple below.
//
// Every status the round will ever need is declared now, because adding an
// enum value later and using it in the same migration run fails. A status
// with no row in the table yet is forbidden from every state until the
// ticket that reaches it adds its row (and the matching row in the test).

export const SCHOOL_ROUND_STATUSES = [
  "open",
  "overdue",
  "finalised",
  "closed_on_behalf",
] as const;

export type SchoolRoundStatus = (typeof SCHOOL_ROUND_STATUSES)[number];

type Transition = {
  /** `null` is a round that does not exist yet. */
  from: SchoolRoundStatus | null;
  to: SchoolRoundStatus;
};

/** Every allowed move. Anything not listed is forbidden. */
export const SCHOOL_ROUND_TRANSITIONS: readonly Transition[] = [
  // One round per confirmed institution registration, opened when the
  // competition enters school judging.
  { from: null, to: "open" },
  // The shortlist deadline passed before the school finalised. Nothing
  // finalises it automatically: the school can still finalise late, or a
  // competition manager closes it on the school's behalf.
  { from: "open", to: "overdue" },
  { from: "overdue", to: "finalised" },
  { from: "overdue", to: "closed_on_behalf" },
  // A competition manager reopens a decided round during school judging:
  // open before the shortlist deadline, overdue after it.
  { from: "finalised", to: "open" },
  { from: "finalised", to: "overdue" },
  { from: "closed_on_behalf", to: "open" },
  { from: "closed_on_behalf", to: "overdue" },
];

/**
 * Statuses in which the coordinator may still change panel and picks. An
 * overdue round stays editable, so the school can still finish it late.
 */
const EDITABLE_STATUSES: readonly SchoolRoundStatus[] = ["open", "overdue"];

export function canTransitionSchoolRound(
  from: SchoolRoundStatus | null,
  to: SchoolRoundStatus
): boolean {
  return SCHOOL_ROUND_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to
  );
}

/** Thrown when a use case tries a move the machine forbids. */
export class SchoolRoundTransitionError extends Error {
  readonly from: SchoolRoundStatus | null;
  readonly to: SchoolRoundStatus;

  constructor(from: SchoolRoundStatus | null, to: SchoolRoundStatus) {
    super(`A school round cannot move ${from ?? "(none)"} -> ${to}`);
    this.name = "SchoolRoundTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Throws `SchoolRoundTransitionError` unless the move is allowed. */
export function assertSchoolRoundTransition(
  from: SchoolRoundStatus | null,
  to: SchoolRoundStatus
): void {
  if (!canTransitionSchoolRound(from, to)) {
    throw new SchoolRoundTransitionError(from, to);
  }
}

/** Whether the coordinator may still record the panel and change picks. */
export function isSchoolRoundEditable(status: SchoolRoundStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}
