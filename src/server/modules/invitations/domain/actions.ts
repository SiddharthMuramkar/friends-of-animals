// What an invitation asks a participant to do next, and what saying yes
// records. Each action continues on the page that owns it: the community
// (join), volunteering, clubs, and the events and campaigns listing.
// Joining the community also earns the community milestone; every other
// action is recorded on the invitation and the person is sent on.
//
// Pure: loads under plain Node (the schema builds its enum from
// INVITATION_ACTIONS).

/** Every action an invitation can offer, in the order the page lists them. */
export const INVITATION_ACTIONS = [
  "join_community",
  "volunteer",
  "start_club",
  "join_campaigns",
  "attend_events",
] as const;

export type InvitationAction = (typeof INVITATION_ACTIONS)[number];

/** Where each action continues once it is recorded. */
export const ACTION_TARGETS = {
  join_community: "/dashboard/community",
  volunteer: "/volunteer",
  start_club: "/clubs/apply",
  join_campaigns: "/events",
  attend_events: "/events",
} as const satisfies Record<InvitationAction, `/${string}`>;

/** From 13 a child may have a login of their own, and so apply for a club. */
export const OWN_LOGIN_MIN_AGE_YEARS = 13;

/** The settings the offer follows (`volunteers.minAgeYears`). */
export type InvitationActionRules = {
  volunteerMinAgeYears: number;
};

/** What decides which actions a participant is offered. */
export type ActionSubject = {
  /** Completed years today; `null` when no date of birth is on file. */
  ageYears: number | null;
  /** Studies at an institution whose verification FOA has completed. */
  studiesAtVerifiedInstitution: boolean;
};

function atLeast(ageYears: number | null, years: number): boolean {
  return ageYears !== null && ageYears >= years;
}

/**
 * The actions this participant can take up. Volunteering needs the
 * volunteer minimum age; starting a club needs a verified institution and
 * an age at which the person can have a login. An unknown age offers only
 * what is open to everyone.
 */
export function offeredActions(
  subject: ActionSubject,
  rules: InvitationActionRules
): InvitationAction[] {
  const offered: Record<InvitationAction, boolean> = {
    join_community: true,
    volunteer: atLeast(subject.ageYears, rules.volunteerMinAgeYears),
    start_club:
      subject.studiesAtVerifiedInstitution &&
      atLeast(subject.ageYears, OWN_LOGIN_MIN_AGE_YEARS),
    join_campaigns: true,
    attend_events: true,
  };
  return INVITATION_ACTIONS.filter((action) => offered[action]);
}

export type TakeActionDecision =
  /** `firstAction`: the invitation counts as accepted from this one. */
  | { kind: "record"; firstAction: boolean }
  | { kind: "unchanged" }
  | { kind: "reject"; code: "action_not_offered" };

/** Whether taking `action` records anything. Each action counts once. */
export function decideTakeAction(input: {
  offered: readonly InvitationAction[];
  taken: readonly InvitationAction[];
  action: InvitationAction;
}): TakeActionDecision {
  if (!input.offered.includes(input.action)) {
    return { kind: "reject", code: "action_not_offered" };
  }
  if (input.taken.includes(input.action)) return { kind: "unchanged" };
  return { kind: "record", firstAction: input.taken.length === 0 };
}
