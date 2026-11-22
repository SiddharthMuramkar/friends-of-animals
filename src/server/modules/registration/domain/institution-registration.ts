// May an institution register for a competition (#75)? One decision, so
// the use case, the competitions page and later tickets give the same
// answer and the same reason. When several things are wrong, the reason
// is the first row of the table in `decideInstitutionRegistration` that
// applies.
//
// Pure: the caller loads the facts.

import type { RegistrationWindow } from "./registration-window";

/**
 * The statuses an institution's registration for a competition can have.
 * Later tickets append theirs (withdrawn, cancelled), each in its own
 * migration.
 */
export const INSTITUTION_REGISTRATION_STATUSES = ["active"] as const;

export type InstitutionRegistrationStatus =
  (typeof INSTITUTION_REGISTRATION_STATUSES)[number];

/** Who a competition takes, as the competition sets it (#70a). */
export type Participation = "individuals" | "institutions" | "both";

export type InstitutionRegistrationFacts = {
  window: RegistrationWindow;
  participation: Participation;
  /** The institution's status (#73); only "verified" may register. */
  institutionStatus: string;
  /** The institution already has a registration for this competition. */
  alreadyRegistered: boolean;
};

export type InstitutionRegistrationRefusal =
  | "not_found"
  | "institutions_not_accepted"
  | "institution_not_verified"
  | "already_registered"
  | "not_open_yet"
  | "closed";

export type InstitutionRegistrationDecision =
  | { ok: true; status: InstitutionRegistrationStatus }
  | { ok: false; reason: InstitutionRegistrationRefusal };

export function decideInstitutionRegistration(
  facts: InstitutionRegistrationFacts
): InstitutionRegistrationDecision {
  // A draft competition does not exist for anyone outside FOA.
  if (facts.window === "unpublished") return refuse("not_found");
  if (facts.participation === "individuals") {
    return refuse("institutions_not_accepted");
  }
  if (facts.institutionStatus !== "verified") {
    return refuse("institution_not_verified");
  }
  // Named before the window: "you are already registered" helps more than
  // "registration is closed" to someone who is.
  if (facts.alreadyRegistered) return refuse("already_registered");
  if (facts.window === "not_open_yet") return refuse("not_open_yet");
  if (facts.window === "closed") return refuse("closed");
  return { ok: true, status: "active" };
}

function refuse(
  reason: InstitutionRegistrationRefusal
): InstitutionRegistrationDecision {
  return { ok: false, reason };
}
