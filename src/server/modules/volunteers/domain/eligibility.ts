// Who may apply to volunteer, and where their application starts. FOA vets
// anyone who will work near children, so the rules are strict: under the
// minimum age (14 by default) is refused outright, and a minor (under 18
// by default) applies only with a verified guardian, who approves before a
// community manager sees the application.
//
// Pure: the use case works out the age with the participants module's
// `ageAt` (completed years on India's calendar at the clock's instant),
// reads the two settings and the applicant's guardian, and passes them in.

import type { VolunteerApplicationStatus } from "./application-status";

/** The two age settings (`volunteers.*` in the settings catalogue). */
export type VolunteerAgeRules = {
  /** Younger than this is refused. */
  minAgeYears: number;
  /** Younger than this needs a guardian's approval. */
  guardianApprovalBelowAgeYears: number;
};

/** FOA's defaults until leadership confirms them. */
export const VOLUNTEER_AGE_RULE_DEFAULTS: VolunteerAgeRules = {
  minAgeYears: 14,
  guardianApprovalBelowAgeYears: 18,
};

/**
 * The range each setting may take. No one under 13 has a login of their
 * own, and everyone under 18 is a child under India's data protection
 * law, so their guardian always decides.
 */
export const VOLUNTEER_AGE_RULE_BOUNDS = {
  minAgeYears: { min: 13, max: 18 },
  guardianApprovalBelowAgeYears: { min: 18, max: 21 },
} as const;

export type VolunteerApplicant = {
  ageYears: number;
  /** The applicant's guardian, through an active guardian link. */
  guardian: "verified" | "unverified" | "none";
  /** Already holds the volunteer role. */
  isVolunteer: boolean;
  /** Has an application waiting on a guardian or a community manager. */
  hasOpenApplication: boolean;
};

export type VolunteerApplicationRefusal =
  | "already_volunteer"
  | "application_open"
  | "under_min_age"
  /** A minor with no verified guardian linked to ask. */
  | "guardian_required";

export type VolunteerApplicationDecision =
  | {
      ok: true;
      status: Extract<
        VolunteerApplicationStatus,
        "awaiting_guardian" | "submitted"
      >;
    }
  | { ok: false; reason: VolunteerApplicationRefusal };

/**
 * Decides whether an application is refused, waits for the guardian, or
 * goes to a community manager. Refusals come in a fixed order: already a
 * volunteer, an application already open, too young, no guardian.
 *
 * A setting outside its bounds is held to them here as well, so a bad
 * value can only ever make the rule stricter.
 */
export function decideVolunteerApplication(input: {
  applicant: VolunteerApplicant;
  rules: VolunteerAgeRules;
}): VolunteerApplicationDecision {
  const { applicant, rules } = input;
  const minAge = Math.max(
    rules.minAgeYears,
    VOLUNTEER_AGE_RULE_BOUNDS.minAgeYears.min
  );
  const guardianBelow = Math.max(
    rules.guardianApprovalBelowAgeYears,
    VOLUNTEER_AGE_RULE_BOUNDS.guardianApprovalBelowAgeYears.min
  );
  if (applicant.isVolunteer) return { ok: false, reason: "already_volunteer" };
  if (applicant.hasOpenApplication) {
    return { ok: false, reason: "application_open" };
  }
  if (applicant.ageYears < minAge) {
    return { ok: false, reason: "under_min_age" };
  }
  if (applicant.ageYears >= guardianBelow) {
    return { ok: true, status: "submitted" };
  }
  return applicant.guardian === "verified"
    ? { ok: true, status: "awaiting_guardian" }
    : { ok: false, reason: "guardian_required" };
}
