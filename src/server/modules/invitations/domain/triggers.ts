// Why an invitation was sent, and the key that makes sending it again a
// no-op. Results publishing invites each participant once per
// competition; the pilot backfill invites each person once in all.
// Redelivered events and repeated backfill runs produce the same key, and
// the database keeps it unique.
//
// Pure: loads under plain Node (the schema builds its enum from
// INVITATION_TRIGGERS).

export const INVITATION_TRIGGERS = [
  "results_published",
  "pilot_backfill",
] as const;

export type InvitationTrigger = (typeof INVITATION_TRIGGERS)[number];

/**
 * The invitation's unique key. A backfill invitation names the person's
 * latest competition for its wording, but the competition is not part of
 * its key: one per person.
 */
export function invitationKey(input: {
  trigger: InvitationTrigger;
  profileId: string;
  competitionId: string;
}): string {
  return input.trigger === "pilot_backfill"
    ? `pilot_backfill:${input.profileId}`
    : `results_published:${input.competitionId}:${input.profileId}`;
}
