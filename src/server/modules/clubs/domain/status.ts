// The club status machine (#121). A student or teacher applies to start a
// club at their institution; the community manager approves or declines
// it, and may later suspend or close it. A suspended club is reinstated by
// approving it again. The applicant may withdraw while it is undecided.
// Declined, withdrawn and closed are final.
//
// Loads under plain Node (schema, seed script), so no "server-only" here.

/** In the order a club usually meets them. */
export const CLUB_STATUSES = [
  "applied",
  "approved",
  "declined",
  "withdrawn",
  "suspended",
  "closed",
] as const;

export type ClubStatus = (typeof CLUB_STATUSES)[number];

/** What can happen to a club. Withdraw is the applicant's; the rest staff's. */
export const CLUB_ACTIONS = [
  "approve",
  "decline",
  "withdraw",
  "suspend",
  "close",
] as const;

export type ClubAction = (typeof CLUB_ACTIONS)[number];

/** What the applicant is told. */
export type ClubOutcome =
  | "approved"
  | "declined"
  | "withdrawn"
  | "suspended"
  | "closed"
  | "reinstated";

type Move = { to: ClubStatus; outcome: ClubOutcome };

/** Every allowed move. An action missing from a status is refused. */
const TRANSITIONS: Record<ClubStatus, Partial<Record<ClubAction, Move>>> = {
  applied: {
    approve: { to: "approved", outcome: "approved" },
    decline: { to: "declined", outcome: "declined" },
    withdraw: { to: "withdrawn", outcome: "withdrawn" },
  },
  approved: {
    suspend: { to: "suspended", outcome: "suspended" },
    close: { to: "closed", outcome: "closed" },
  },
  declined: {},
  withdrawn: {},
  suspended: {
    approve: { to: "approved", outcome: "reinstated" },
    close: { to: "closed", outcome: "closed" },
  },
  closed: {},
};

/**
 * Statuses that take one of the institution's places
 * (`clubs.maxPerInstitution`). A suspended club keeps its place, so
 * reinstating it never needs a free one.
 */
const HOLDS_PLACE: ReadonlySet<ClubStatus> = new Set<ClubStatus>([
  "approved",
  "suspended",
]);

export function holdsInstitutionPlace(status: ClubStatus): boolean {
  return HOLDS_PLACE.has(status);
}

/** Saying no, or stopping a club, needs a reason the applicant is shown. */
const NEEDS_REASON: ReadonlySet<ClubAction> = new Set<ClubAction>([
  "decline",
  "suspend",
  "close",
]);

export const CLUB_REASON_MAX_LENGTH = 1000;

export type ClubStatusChange =
  | {
      ok: true;
      to: ClubStatus;
      outcome: ClubOutcome;
      /** Trimmed, as stored and shown; null when none was given. */
      reason: string | null;
    }
  | {
      ok: false;
      error:
        | "transition_not_allowed"
        | "club_limit_reached"
        | "reason_required"
        | "reason_too_long";
    };

/** Where `action` takes a club in status `from`, if anywhere. */
export function decideClubStatus(input: {
  from: ClubStatus;
  action: ClubAction;
  reason: string;
  /** Clubs at the institution that hold a place, counted under a lock. */
  slotsHeld: number;
  maxPerInstitution: number;
}): ClubStatusChange {
  const move = TRANSITIONS[input.from][input.action];
  if (!move) return { ok: false, error: "transition_not_allowed" };
  const takesPlace =
    holdsInstitutionPlace(move.to) && !holdsInstitutionPlace(input.from);
  if (takesPlace && input.slotsHeld >= input.maxPerInstitution) {
    return { ok: false, error: "club_limit_reached" };
  }
  const reason = input.reason.trim();
  if (reason === "" && NEEDS_REASON.has(input.action)) {
    return { ok: false, error: "reason_required" };
  }
  if (reason.length > CLUB_REASON_MAX_LENGTH) {
    return { ok: false, error: "reason_too_long" };
  }
  return { ok: true, ...move, reason: reason === "" ? null : reason };
}
