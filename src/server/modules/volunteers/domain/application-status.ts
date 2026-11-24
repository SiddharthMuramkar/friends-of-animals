// The volunteer application's states and the moves between them. An
// adult's application goes straight to a community manager (submitted); a
// 14- to 17-year-old's waits for their guardian first (awaiting_guardian).
// How an application starts is decided in `eligibility.ts`, not here: this
// table covers only what happens after it exists.
//
// Pure: loads under plain Node, so the schema can build its pgEnum from
// VOLUNTEER_APPLICATION_STATUSES.

export const VOLUNTEER_APPLICATION_STATUSES = [
  "awaiting_guardian",
  "guardian_declined",
  "submitted",
  "approved",
  "declined",
  "withdrawn",
] as const;

export type VolunteerApplicationStatus =
  (typeof VOLUNTEER_APPLICATION_STATUSES)[number];

/** What can happen to an application, whoever does it. */
export const VOLUNTEER_APPLICATION_EVENTS = [
  /** The applicant's guardian agrees. */
  "guardian_approve",
  /** The applicant's guardian refuses. */
  "guardian_decline",
  /** The applicant, or their guardian, takes the application back. */
  "withdraw",
  /** A community manager approves: the volunteer role is granted. */
  "approve",
  /** A community manager declines, with a reason. */
  "decline",
] as const;

export type VolunteerApplicationEvent =
  (typeof VOLUNTEER_APPLICATION_EVENTS)[number];

/**
 * Every allowed move; anything missing is refused. Closed statuses
 * (guardian_declined, approved, declined, withdrawn) have no moves: the
 * person applies again with a new application instead.
 */
const TRANSITIONS: Readonly<
  Record<
    VolunteerApplicationStatus,
    Partial<Record<VolunteerApplicationEvent, VolunteerApplicationStatus>>
  >
> = {
  awaiting_guardian: {
    guardian_approve: "submitted",
    guardian_decline: "guardian_declined",
    withdraw: "withdrawn",
  },
  submitted: {
    approve: "approved",
    decline: "declined",
    withdraw: "withdrawn",
  },
  guardian_declined: {},
  approved: {},
  declined: {},
  withdrawn: {},
};

export type VolunteerApplicationTransition =
  | { ok: true; to: VolunteerApplicationStatus }
  | { ok: false; reason: "invalid_transition" };

/** The status `event` moves an application in `from` to, or a refusal. */
export function transitionVolunteerApplication(
  from: VolunteerApplicationStatus,
  event: VolunteerApplicationEvent
): VolunteerApplicationTransition {
  const to = TRANSITIONS[from][event];
  return to ? { ok: true, to } : { ok: false, reason: "invalid_transition" };
}

/**
 * Statuses still waiting on someone. A person has at most one open
 * application: the schema's partial unique index uses this list.
 */
export const OPEN_VOLUNTEER_APPLICATION_STATUSES = [
  "awaiting_guardian",
  "submitted",
] as const satisfies readonly VolunteerApplicationStatus[];

export function isOpenVolunteerApplication(
  status: VolunteerApplicationStatus
): boolean {
  return (OPEN_VOLUNTEER_APPLICATION_STATUSES as readonly string[]).includes(
    status
  );
}
