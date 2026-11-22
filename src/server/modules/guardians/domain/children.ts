// What a guardian may do for each child: add them, invite them to an own
// login, and when that invitation may be accepted. Under 13 a child has a
// profile the guardian manages and no login; from 13 to 17 the child gets an
// own login, linked to the guardian; adults register themselves.
//
// Pure: the use cases load the facts, work out the child's age with the
// participants module's `ageAt` (completed years on India's calendar at the
// clock's instant) and pass it in. Loads under plain Node: relative
// imports only.

import { ADULT_AGE } from "../../participants/domain/age";

/** The age from which a person is an adult and registers themselves (#78). */
export { ADULT_AGE };

/** The age from which a child may have an own login. */
export const MINOR_LOGIN_MIN_AGE = 13;

/** A guardian-managed profile with no login, or one with a linked login. */
export type ChildKind = "managed" | "linked";

/** The kind of profile a child of `ageYears` completed years has. */
export function childKindForAge(ageYears: number): ChildKind | "adult" {
  if (ageYears >= ADULT_AGE) return "adult";
  return ageYears >= MINOR_LOGIN_MIN_AGE ? "linked" : "managed";
}

export type AddChildRefusal = "guardian_not_verified" | "dob_invalid" | "adult";

export type AddChildDecision =
  | { ok: true; kind: ChildKind }
  | { ok: false; reason: AddChildRefusal };

/**
 * May this guardian add a child of this age? A guardian verifies by code
 * before adding anyone, so no child's details are stored before that.
 * `ageYears` is null when the date of birth could not be read.
 */
export function decideAddChild(input: {
  guardianVerified: boolean;
  ageYears: number | null;
}): AddChildDecision {
  if (!input.guardianVerified) {
    return { ok: false, reason: "guardian_not_verified" };
  }
  if (input.ageYears === null) return { ok: false, reason: "dob_invalid" };
  const kind = childKindForAge(input.ageYears);
  return kind === "adult" ? { ok: false, reason: "adult" } : { ok: true, kind };
}

export type TeenInviteRefusal =
  | "under_13"
  | "adult"
  | "child_has_login"
  | "invitee_is_guardian";

/** Refuses a child outside 13 to 17, the age reason before any other. */
function ageRefusal(ageYears: number): "under_13" | "adult" | null {
  const kind = childKindForAge(ageYears);
  if (kind === "managed") return "under_13";
  return kind === "adult" ? "adult" : null;
}

/**
 * May a guardian invite this child to an own login? Only a 13- to
 * 17-year-old without one, and never at an address that belongs to one of
 * the child's guardians: the login must be the child's own.
 */
export function decideTeenInvite(input: {
  ageYears: number;
  childHasLogin: boolean;
  inviteeIsAGuardian: boolean;
}): { ok: true } | { ok: false; reason: TeenInviteRefusal } {
  const tooYoungOrOld = ageRefusal(input.ageYears);
  if (tooYoungOrOld) return { ok: false, reason: tooYoungOrOld };
  if (input.childHasLogin) return { ok: false, reason: "child_has_login" };
  if (input.inviteeIsAGuardian) {
    return { ok: false, reason: "invitee_is_guardian" };
  }
  return { ok: true };
}

export type TeenAcceptanceRefusal =
  | "not_found"
  | "already_used"
  | "withdrawn"
  | "expired"
  | "guardian_cannot_accept"
  | "contact_mismatch"
  | "accepter_is_guardian"
  | "accepter_is_adult"
  | "already_linked"
  | "child_has_login"
  | "under_13"
  | "adult";

export type TeenInvitationState = {
  status: "pending" | "accepted" | "revoked";
  expiresAt: Date;
};

/**
 * May the signed-in user accept this teen-login invitation? The invitation
 * is checked first (an unknown token says nothing more), then who is
 * accepting: only the invited contact, signed in with it, who is no
 * guardian at all, has not registered themselves as an adult (#78) and is
 * not already another child's login. A minor's login never holds the
 * guardian role, so it can't add or manage children; registering as a
 * guardian refuses a linked login the other way round. Last, the child
 * must still be 13 to 17 and without a login at `now`.
 */
export function decideTeenAcceptance(input: {
  /** Null when no invitation has this token. */
  invitation: TeenInvitationState | null;
  now: Date;
  accepter: {
    /** The signed-in user's verified address is the invited one. */
    isTheInvitedContact: boolean;
    isAGuardianOfChild: boolean;
    /** Has declared as a guardian, or holds the role, for any child. */
    isAGuardian: boolean;
    /**
     * Keeps a profile of their own, which only an adult's date of birth
     * gets (#78): the login must be a child's.
     */
    registeredAsAnAdult: boolean;
    linkedToAnotherChild: boolean;
  };
  child: { ageYears: number; hasLogin: boolean };
}): { ok: true } | { ok: false; reason: TeenAcceptanceRefusal } {
  const refuse = (reason: TeenAcceptanceRefusal) =>
    ({ ok: false, reason }) as const;
  const { invitation, accepter, child } = input;

  if (!invitation) return refuse("not_found");
  if (invitation.status === "accepted") return refuse("already_used");
  if (invitation.status === "revoked") return refuse("withdrawn");
  if (invitation.expiresAt.getTime() <= input.now.getTime()) {
    return refuse("expired");
  }
  if (accepter.isAGuardianOfChild) return refuse("guardian_cannot_accept");
  if (!accepter.isTheInvitedContact) return refuse("contact_mismatch");
  if (accepter.isAGuardian) return refuse("accepter_is_guardian");
  if (accepter.registeredAsAnAdult) return refuse("accepter_is_adult");
  if (accepter.linkedToAnotherChild) return refuse("already_linked");
  if (child.hasLogin) return refuse("child_has_login");
  const tooYoungOrOld = ageRefusal(child.ageYears);
  if (tooYoungOrOld) return refuse(tooYoungOrOld);
  return { ok: true };
}
