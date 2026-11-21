// Who a participant's invitation goes to, and on whose consent. The rule
// matches campaign messages, so a family hears from FOA on one basis:
//
//   - an adult gets their own invitation, only with their own consent to
//     news and updates (`messages`);
//   - a minor's invitation goes to the guardian who gave the child's
//     `communications` consent, while that guardian's link is active and
//     verified. Never to the child, even a teen with their own login.
//
// No consent, no invitation. Pure: the use case works out the age with the
// participants module's `ageAt` on the clock's instant, reads the two
// consents and the child's guardians, and passes them in.

/** Under India's data protection law everyone under 18 is a child. */
export const ADULT_AGE_YEARS = 18;

/**
 * The latest consent event for one subject and purpose. Only `given` lets
 * an invitation go.
 */
export type ConsentStatus =
  | { status: "never" }
  | {
      status: "given" | "withdrawn";
      /** The latest event's id. */
      eventId: string;
      /** Who gave or withdrew it. For a child, a guardian. */
      giverUserId: string;
    };

/** One participant, with everything that decides their invitation. */
export type InvitationSubject = {
  /** Completed years today; `null` when no date of birth is on file. */
  ageYears: number | null;
  /** Their own login: an adult's account, or a teen's linked login. */
  ownUserId: string | null;
  /** The person's own `messages` consent (their user is the subject). */
  messagesConsent: ConsentStatus;
  /** The child's `communications` consent (their profile is the subject). */
  communicationsConsent: ConsentStatus;
  /** Users whose guardian link to the profile is active and verified. */
  activeGuardianUserIds: readonly string[];
};

export type InvitationRecipient = {
  userId: string;
  relation: "self" | "guardian";
};

/** The consent event an invitation rests on, kept with the invitation. */
export type ConsentBasis = {
  purpose: "messages" | "communications";
  eventId: string;
};

export type InvitationSkipReason =
  /** No current consent for this person. */
  | "no_consent"
  /** A child's consent was given by someone no longer their guardian. */
  | "no_guardian"
  /** An adult with no account to send to (a school-entered profile). */
  | "no_login";

export type RecipientDecision =
  | { ok: true; recipient: InvitationRecipient; basis: ConsentBasis }
  | { ok: false; reason: InvitationSkipReason };

/**
 * An unknown age counts as a minor, so nobody is contacted directly
 * unless they are known to be an adult.
 */
export function isAdult(ageYears: number | null): boolean {
  return ageYears !== null && ageYears >= ADULT_AGE_YEARS;
}

/** Who gets this participant's invitation, or why nobody does. */
export function decideRecipient(subject: InvitationSubject): RecipientDecision {
  if (isAdult(subject.ageYears)) {
    if (subject.ownUserId === null) return { ok: false, reason: "no_login" };
    const consent = subject.messagesConsent;
    if (consent.status !== "given") return { ok: false, reason: "no_consent" };
    return {
      ok: true,
      recipient: { userId: subject.ownUserId, relation: "self" },
      basis: { purpose: "messages", eventId: consent.eventId },
    };
  }
  const consent = subject.communicationsConsent;
  if (consent.status !== "given") return { ok: false, reason: "no_consent" };
  if (!subject.activeGuardianUserIds.includes(consent.giverUserId)) {
    return { ok: false, reason: "no_guardian" };
  }
  return {
    ok: true,
    recipient: { userId: consent.giverUserId, relation: "guardian" },
    basis: { purpose: "communications", eventId: consent.eventId },
  };
}
