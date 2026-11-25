// The event registration status machine (#125). Someone registers and gets
// a place, or joins the waitlist when the event is full; a freed place
// promotes the next person waiting. At the event they are checked in, and
// anyone still only registered when it ends is a no-show.
//
// The `event_registration_status` enum is built from this list. Every
// status exists from the start, check-in's included, so later work adds
// moves here, never values to the enum (a value added and used in one
// migration run fails).
//
// Pure: no I/O, no "server-only", no `@/` imports.

export const REGISTRATION_STATUSES = [
  /** Has a place. */
  "registered",
  /** Waiting for a place, in order of joining. */
  "waitlisted",
  /** Withdrawn by the attendee, their guardian or staff. Final. */
  "cancelled",
  /** Came: checked in by an organiser. Final. */
  "checked_in",
  /** Registered but never checked in by the end. Final. */
  "no_show",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/**
 * A person's one registration for an event: the partial unique index on
 * (event, attendee) covers these. After a cancellation they may register
 * again, as a new row.
 */
export const ACTIVE_REGISTRATION_STATUSES = [
  "registered",
  "waitlisted",
  "checked_in",
  "no_show",
] as const satisfies readonly RegistrationStatus[];

/** The statuses that take one of the event's places. */
export const PLACE_HOLDING_STATUSES = [
  "registered",
  "checked_in",
] as const satisfies readonly RegistrationStatus[];

export type RegistrationTrigger =
  | "registered"
  | "waitlisted"
  | "promoted"
  | "cancelled"
  | "checked_in"
  | "marked_no_show";

type Move = {
  /** null: the row is being created. */
  from: RegistrationStatus | null;
  to: RegistrationStatus;
  trigger: RegistrationTrigger;
};

export const REGISTRATION_MOVES: readonly Move[] = [
  { from: null, to: "registered", trigger: "registered" },
  { from: null, to: "waitlisted", trigger: "waitlisted" },
  { from: "waitlisted", to: "registered", trigger: "promoted" },
  { from: "registered", to: "cancelled", trigger: "cancelled" },
  { from: "waitlisted", to: "cancelled", trigger: "cancelled" },
  // Someone on the waitlist is promoted first; they are never let in
  // straight from it, so the capacity count stays true.
  { from: "registered", to: "checked_in", trigger: "checked_in" },
  { from: "registered", to: "no_show", trigger: "marked_no_show" },
];

export class RegistrationTransitionError extends Error {
  constructor(from: RegistrationStatus | null, to: RegistrationStatus) {
    super(`A registration can't move from ${from ?? "(new)"} to ${to}`);
    this.name = "RegistrationTransitionError";
  }
}

/** Whether the table allows a registration to move from `from` to `to`. */
export function canMoveRegistration(
  from: RegistrationStatus | null,
  to: RegistrationStatus
): boolean {
  return REGISTRATION_MOVES.some(
    (move) => move.from === from && move.to === to
  );
}

/** Returns `to`, or throws RegistrationTransitionError for a forbidden move. */
export function moveRegistration(
  from: RegistrationStatus | null,
  to: RegistrationStatus
): RegistrationStatus {
  if (!canMoveRegistration(from, to)) {
    throw new RegistrationTransitionError(from, to);
  }
  return to;
}
