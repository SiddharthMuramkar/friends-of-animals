// A teen who registers for a competition with no guardian on the platform
// names one: their name, how they are related, and an email address or
// phone number. FOA sends that person a guardian request: a link they open
// after signing in with that same address. Once they have verified as a
// guardian and accepted, they become the teen's guardian and the teen's
// held registrations can be paid for.
//
// Pure: the use cases normalise addresses, find the child's pending request
// by its blind index and pass the facts in, with the clock's instant. Loads
// under plain Node.

/** How long a guardian request's link works, like a teen login invitation's. */
export const GUARDIAN_REQUEST_TTL_DAYS = 7;

/** An email address or phone number, normalised the way accounts store it. */
export type ContactAddress = { channel: "email" | "phone"; address: string };

export type GuardianRequestRefusal =
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
 * replaces it.
 */
export function decideGuardianRequest(input: {
  /** Where the teen asked FOA to send the request; null if they named nobody. */
  guardianContact: ContactAddress | null;
  /** The teen's own verified email address and phone number. */
  ownContacts: readonly ContactAddress[];
  /** The child's request still waiting for an answer, if any. */
  pending: { sameContact: boolean; expiresAt: Date } | null;
  now: Date;
}): GuardianRequestDecision {
  const { guardianContact, pending } = input;
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
  | "guardian_not_verified"
  | "already_linked";

/**
 * May the signed-in user accept this guardian request? The request is
 * checked first (an unknown token says nothing more), then who is
 * accepting: never the teen who asked, only the person asked, signed in
 * with that address, who has verified as a guardian (81a). Last, the
 * teen's login must not have been linked to another child's profile since
 * they asked.
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
  };
  teenLinkedElsewhere: boolean;
}): { ok: true } | { ok: false; reason: GuardianRequestAcceptanceRefusal } {
  const refuse = (reason: GuardianRequestAcceptanceRefusal) =>
    ({ ok: false, reason }) as const;
  const { request, accepter } = input;

  if (!request) return refuse("not_found");
  if (request.status === "accepted") return refuse("already_used");
  if (request.status === "revoked") return refuse("withdrawn");
  if (request.expiresAt.getTime() <= input.now.getTime()) {
    return refuse("expired");
  }
  if (accepter.isTheRequester) return refuse("requester_cannot_accept");
  if (!accepter.isTheRequestedContact) return refuse("contact_mismatch");
  if (!accepter.guardianVerified) return refuse("guardian_not_verified");
  if (input.teenLinkedElsewhere) return refuse("already_linked");
  return { ok: true };
}

function sameAddress(a: ContactAddress, b: ContactAddress): boolean {
  return a.channel === b.channel && a.address === b.address;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a request sent at `now` stops working. */
function requestExpiry(now: Date): Date {
  return new Date(now.getTime() + GUARDIAN_REQUEST_TTL_DAYS * DAY_MS);
}
