// How a minor's individual registration starts. A minor takes part only
// with a guardian: a registration whose guardian has not verified yet is
// held as pending_guardian and can't be paid for or confirmed; once the
// guardian has verified it waits for payment like an adult's.
//
// Pure: the use case works out the subject's age with `ageAt` (completed
// years on India's calendar at the registration instant), loads who is
// registering and their guardian's state, and passes them in.

// The guardians module (81a) and the age rules (#78) hold the same two
// limits; once both are on the trunk this file imports them instead.
const OWN_LOGIN_MIN_AGE = 13;
const ADULT_AGE = 18;

/** Who is registering the minor. */
export type MinorRegistrant =
  /** The minor themselves, with their guardian's state. */
  | { kind: "self"; guardian: "verified" | "unverified" | "none" }
  /** A guardian registering their own child. */
  | { kind: "guardian"; verified: boolean };

export type MinorRegistrationRefusal =
  /** Under 13 has no login of their own: a guardian registers them. */
  | "under_13_needs_guardian"
  /** A guardian can't register someone who is 18 or over. */
  | "adult_registers_self"
  /** An adult registering themselves: the adult rules apply, not these. */
  | "not_a_minor";

export type MinorRegistrationDecision =
  | {
      ok: true;
      status: "pending_payment" | "pending_guardian";
      /** The minor named no guardian yet: send a request to the one they name. */
      askGuardian: boolean;
    }
  | { ok: false; reason: MinorRegistrationRefusal };

/**
 * Decides how a minor's individual registration starts: refused, held for
 * the guardian (and whether a guardian must be asked first), or waiting for
 * payment because the guardian has already verified.
 */
export function decideMinorRegistration(input: {
  ageYears: number;
  registrant: MinorRegistrant;
}): MinorRegistrationDecision {
  const { ageYears, registrant } = input;
  if (ageYears >= ADULT_AGE) {
    const reason =
      registrant.kind === "guardian" ? "adult_registers_self" : "not_a_minor";
    return { ok: false, reason };
  }
  if (registrant.kind === "guardian") {
    return registrant.verified
      ? { ok: true, status: "pending_payment", askGuardian: false }
      : { ok: true, status: "pending_guardian", askGuardian: false };
  }
  if (ageYears < OWN_LOGIN_MIN_AGE) {
    return { ok: false, reason: "under_13_needs_guardian" };
  }
  switch (registrant.guardian) {
    case "verified":
      return { ok: true, status: "pending_payment", askGuardian: false };
    case "unverified":
      return { ok: true, status: "pending_guardian", askGuardian: false };
    case "none":
      return { ok: true, status: "pending_guardian", askGuardian: true };
  }
}
