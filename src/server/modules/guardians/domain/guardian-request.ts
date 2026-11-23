// A teen who registers for a competition with no guardian on the platform
// names one: their name, how they are related, and an email address. FOA
// sends that person a guardian request: a link they open after signing in
// with that same address. Once they have verified as a guardian and
// accepted, they become the teen's guardian, the teen's account becomes
// the login of the profile they now keep, and the teen's held
// registrations can be paid for.
//
// A child's login never holds the guardian role or a staff, school or
// judge role (as for 81a's teen login invitation): an account that does
// can't ask, and can't be made a child's login when the guardian accepts.
//
// Pure: the use cases normalise addresses, find the child's pending request
// by its blind index and pass the facts in, with the clock's instant. Loads
// under plain Node.

/** How long a guardian request's link works, like a teen login invitation's. */
export const GUARDIAN_REQUEST_TTL_DAYS = 7;

/** An email address, normalised the way accounts store it. */
export type ContactAddress = { channel: "email"; address: string };

/** What the teen's account holds, beyond being a member (../account-roles.ts). */
export type RequesterRoles = {
  /** Has declared as a guardian, or holds the guardian role. */
  isAGuardian: boolean;
  /** Holds a staff, school, judge or other role. */
  holdsOtherRole: boolean;
};

export type GuardianRequestRefusal =
  /** A guardian's, staff, school or judge account can't be a child's login. */
  | "requester_has_role"
  /** The teen has no guardian yet and named nobody to ask. */
  | "guardian_details_required"
  /** The teen named one of their own addresses. */
  | "guardian_contact_is_self";

export type GuardianRequestDecision =
  /** Send a new request; "replace" withdraws the child's pending one first. */
  | { ok: true; action: "send" | "replace"; expiresAt: Date }
  /** The same person was already asked and can still answer: send nothing. */
  | { ok: true; action: "reuse" }
  | { ok: false; reason: GuardianRequestRefusal };

/**
 * Whether to ask the guardian a teen named, for a registration held until a
 * guardian accepts. A child has at most one request waiting: naming the
 * same person again, or nobody, sends nothing more while its link works;
 * naming someone else, or asking again once the link has expired,
 * replaces it. An account that holds a role a child's login can't is
 * refused first.
 */
export function decideGuardianRequest(input: {
  /** The teen's account, signed in. */
  requester: RequesterRoles;
  /** Where the teen asked FOA to send the request; null if they named nobody. */
  guardianContact: ContactAddress | null;
  /** The teen's own verified email address. */
  ownContacts: readonly ContactAddress[];
  /** The child's request still waiting for an answer, if any. */
  pending: { sameContact: boolean; expiresAt: Date } | null;
  now: Date;
}): GuardianRequestDecision {
  const { guardianContact, pending } = input;
  if (holdsARole(input.requester)) {
    return { ok: false, reason: "requester_has_role" };
  }
  const live = pending !== null && pending.expiresAt > input.now;
  if (!guardianContact) {
    return live
      ? { ok: true, action: "reuse" }
      : { ok: false, reason: "guardian_details_required" };
  }
  if (input.ownContacts.some((own) => sameAddress(own, guardianContact))) {
    return { ok: false, reason: "guardian_contact_is_self" };
  }
  if (live && pending.sameContact) return { ok: true, action: "reuse" };
  return {
    ok: true,
    action: pending ? "replace" : "send",
    expiresAt: requestExpiry(input.now),
  };
}

export type GuardianRequestAcceptanceRefusal =
  | "not_found"
  | "already_used"
  | "withdrawn"
  | "expired"
  | "requester_cannot_accept"
  | "contact_mismatch"
  /** The account asked registered itself with a date of birth under 18. */
  | "accepter_is_minor"
  | "guardian_not_verified"
  | "child_already_added"
  | "already_linked"
  | "requester_is_adult"
  | "requester_has_role";

/**
 * May the signed-in user accept this guardian request? The request is
 * checked first (an unknown token says nothing more), then who is
 * accepting: never the teen who asked, only the person asked, signed in
 * with that address, whose own profile (if any) isn't a minor's, who has
 * verified as a guardian (#81). If they already keep a matching profile,
 * recovery goes through the teen's login invitation. A minor asked is told
 * so before being told to verify, which they can't.
 * Last, the teen: their login must not have been linked to another
 * child's profile since they asked, they must still be under 18, and their
 * account must hold no role a child's login can't (guardian, staff, school
 * or judge), all read when the guardian accepts.
 */
export function decideGuardianRequestAcceptance(input: {
  /** Null when no guardian request has this token. */
  request: {
    status: "pending" | "accepted" | "revoked";
    expiresAt: Date;
  } | null;
  now: Date;
  accepter: {
    isTheRequester: boolean;
    /** The signed-in user's verified address is the one the teen gave. */
    isTheRequestedContact: boolean;
    /** Has declared as a guardian and confirmed it by code. */
    guardianVerified: boolean;
    /**
     * Their own participant profile, by its date of birth now: none, an
     * adult's, or a minor's (a teen who registered alone, #81).
     */
    ownProfile: "none" | "adult" | "minor";
  };
  /** A matching profile exists and cannot be safely claimed. */
  childAlreadyAdded: boolean;
  /** The teen who asked, as they are now. */
  requester: RequesterRoles & {
    /** Their login is already another child's profile's. */
    linkedElsewhere: boolean;
    /** 18 or over on India's calendar now, by the profile's date of birth. */
    isAdult: boolean;
  };
}): { ok: true } | { ok: false; reason: GuardianRequestAcceptanceRefusal } {
  const refuse = (reason: GuardianRequestAcceptanceRefusal) =>
    ({ ok: false, reason }) as const;
  const { request, accepter, requester } = input;

  if (!request) return refuse("not_found");
  if (request.status === "accepted") return refuse("already_used");
  if (request.status === "revoked") return refuse("withdrawn");
  if (request.expiresAt.getTime() <= input.now.getTime()) {
    return refuse("expired");
  }
  if (accepter.isTheRequester) return refuse("requester_cannot_accept");
  if (!accepter.isTheRequestedContact) return refuse("contact_mismatch");
  if (accepter.ownProfile === "minor") return refuse("accepter_is_minor");
  if (!accepter.guardianVerified) return refuse("guardian_not_verified");
  if (input.childAlreadyAdded) return refuse("child_already_added");
  if (requester.linkedElsewhere) return refuse("already_linked");
  if (requester.isAdult) return refuse("requester_is_adult");
  if (holdsARole(requester)) return refuse("requester_has_role");
  return { ok: true };
}

function holdsARole(roles: RequesterRoles): boolean {
  return roles.isAGuardian || roles.holdsOtherRole;
}

function sameAddress(a: ContactAddress, b: ContactAddress): boolean {
  return a.channel === b.channel && a.address === b.address;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a request sent at `now` stops working. */
function requestExpiry(now: Date): Date {
  return new Date(now.getTime() + GUARDIAN_REQUEST_TTL_DAYS * DAY_MS);
}
