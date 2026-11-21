// The one-off backfill for the pilot cohort, who finished before
// invitations existed. Everyone who took part in a competition with
// published results and has no invitation yet is invited once, about the
// latest competition they took part in. Anyone invited before (by results
// or an earlier run) is left out, so running it again sends nothing new.
//
// Pure: the use case loads the candidates and the people already invited,
// plans here, then decides each recipient and tallies the outcomes for the
// audit row.

import type { InvitationSkipReason } from "./recipient";

/** One participation in a competition whose results are published. */
export type BackfillCandidate = {
  profileId: string;
  competitionId: string;
  publishedAt: Date;
};

export type BackfillPlan = {
  /** One per person not yet invited, by profile id. */
  invite: { profileId: string; competitionId: string }[];
  counts: {
    /** Distinct people among the candidates. */
    people: number;
    /** Of those, people who already have an invitation. */
    alreadyInvited: number;
  };
};

function isLater(a: BackfillCandidate, b: BackfillCandidate): boolean {
  const byTime = a.publishedAt.getTime() - b.publishedAt.getTime();
  return byTime === 0 ? a.competitionId > b.competitionId : byTime > 0;
}

/** Who the backfill invites, and about which competition. */
export function planBackfill(
  candidates: readonly BackfillCandidate[],
  invitedProfileIds: ReadonlySet<string>
): BackfillPlan {
  const latest = new Map<string, BackfillCandidate>();
  for (const candidate of candidates) {
    const current = latest.get(candidate.profileId);
    if (!current || isLater(candidate, current)) {
      latest.set(candidate.profileId, candidate);
    }
  }
  const people = [...latest.values()];
  const invite = people
    .filter((person) => !invitedProfileIds.has(person.profileId))
    .map(({ profileId, competitionId }) => ({ profileId, competitionId }))
    .toSorted((a, b) =>
      a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0
    );
  return {
    invite,
    counts: {
      people: people.length,
      alreadyInvited: people.length - invite.length,
    },
  };
}

/**
 * What happened to one planned person. `already_invited` covers an
 * invitation another run or the results consumer wrote in between.
 */
export type InvitationOutcome =
  | { ok: true }
  | { ok: false; reason: InvitationSkipReason | "already_invited" };

export type InvitationTally = {
  invited: number;
  alreadyInvited: number;
  skipped: { noConsent: number; noGuardian: number; noLogin: number };
};

/** Counts for the audit row and the staff screen: numbers only. */
export function tallyInvitations(
  outcomes: readonly InvitationOutcome[],
  plan: { alreadyInvited: number }
): InvitationTally {
  const tally: InvitationTally = {
    invited: 0,
    alreadyInvited: plan.alreadyInvited,
    skipped: { noConsent: 0, noGuardian: 0, noLogin: 0 },
  };
  for (const outcome of outcomes) {
    if (outcome.ok) tally.invited += 1;
    else if (outcome.reason === "already_invited") tally.alreadyInvited += 1;
    else if (outcome.reason === "no_consent") tally.skipped.noConsent += 1;
    else if (outcome.reason === "no_guardian") tally.skipped.noGuardian += 1;
    else tally.skipped.noLogin += 1;
  }
  return tally;
}
