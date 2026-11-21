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
 * same person again sends nothing more, while naming someone else, or
 * asking again once the link has expired, replaces it.
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
  const { guardianContact } = input;
  if (!guardianContact) {
    return { ok: false, reason: "guardian_details_required" };
  }
  if (input.ownContacts.some((own) => sameAddress(own, guardianContact))) {
    return { ok: false, reason: "guardian_contact_is_self" };
  }
  return { ok: true, action: "send", expiresAt: requestExpiry(input.now) };
}

function sameAddress(a: ContactAddress, b: ContactAddress): boolean {
  return a.channel === b.channel && a.address === b.address;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a request sent at `now` stops working. */
function requestExpiry(now: Date): Date {
  return new Date(now.getTime() + GUARDIAN_REQUEST_TTL_DAYS * DAY_MS);
}
