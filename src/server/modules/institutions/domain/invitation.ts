// The life of a coordinator invitation (#74). The database stores pending,
// accepted or revoked; "expired" is never stored but read from `expiresAt`
// against the clock, so no job has to flip rows and an expired link stops
// working at the exact instant.
//
// Pure: no database, no clock of its own. Loads under plain Node (the seed
// script), so relative imports only and no "server-only".

/** How long an invitation link works: seven days. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What the `institution_invitation_status` column holds. */
export type StoredInvitationStatus = "pending" | "accepted" | "revoked";

/** What an invitation is at a given instant. */
export type InvitationStatus = StoredInvitationStatus | "expired";

/** The parts of an invitation its life depends on. */
export type InvitationState = {
  status: StoredInvitationStatus;
  expiresAt: Date;
};

/** Accept the invitation, or withdraw it (also used to replace an old link). */
export type InvitationAction = "accept" | "revoke";

/** Why an action was refused, in the words the use cases return. */
export type InvitationRefusal = "expired" | "already_accepted" | "revoked";

export type InvitationDecision =
  | { ok: true; status: StoredInvitationStatus }
  | { ok: false; reason: InvitationRefusal };

/** When an invitation sent at `sentAt` stops working. */
export function invitationExpiresAt(
  sentAt: Date,
  ttlMs: number = INVITATION_TTL_MS
): Date {
  return new Date(sentAt.getTime() + ttlMs);
}

/** The invitation's status at `now`: pending turns expired at `expiresAt`. */
export function invitationStatus(
  invitation: InvitationState,
  now: Date
): InvitationStatus {
  if (
    invitation.status === "pending" &&
    now.getTime() >= invitation.expiresAt.getTime()
  ) {
    return "expired";
  }
  return invitation.status;
}

/**
 * Whether `action` may happen to the invitation at `now`, and the status to
 * store if so. Accepting needs a live invitation. Withdrawing works on any
 * invitation still stored as pending, expired or not.
 */
export function decideInvitation(
  action: InvitationAction,
  invitation: InvitationState,
  now: Date
): InvitationDecision {
  const status = invitationStatus(invitation, now);
  if (status === "accepted") return { ok: false, reason: "already_accepted" };
  if (status === "revoked") return { ok: false, reason: "revoked" };
  if (action === "revoke") return { ok: true, status: "revoked" };
  if (status === "expired") return { ok: false, reason: "expired" };
  return { ok: true, status: "accepted" };
}
