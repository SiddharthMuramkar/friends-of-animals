// Who may file which rights request about whom (#115). Adults file for
// themselves. A verified guardian files for a child linked to them while
// the child is under 18; from 18 the child's rights are their own. A 13- to
// 17-year-old with their own login may ask for access and correction, but
// erasure of a minor's data goes through the guardian (default until
// counsel rules, HR-30). An under-13 has no login, so never files.
//
// Pure: the use case loads the requester's age (their own participant
// profile's date of birth, decrypted) and the guardian link, and passes
// them in. Loads under plain Node.

import type { PrivacyRequestType } from "./request-status";

/** Ages from #81: own login from 13, adult from 18. */
const OWN_LOGIN_MIN_AGE = 13;
const ADULT_AGE = 18;

export type FilingTarget =
  | { kind: "self" }
  | {
      kind: "child";
      /** Completed years at the clock's instant, on India's calendar. */
      childAgeYears: number;
      /** The requester's guardian link to this child, if any. */
      guardian: "verified" | "unverified" | "not_linked";
    };

/** How the requester relates to the data principal. */
export const REQUEST_RELATIONS = ["self", "guardian"] as const;

export type RequestRelation = (typeof REQUEST_RELATIONS)[number];

/** Whose data: an account, or a guardian-managed participant profile. */
export const PRIVACY_SUBJECT_KINDS = ["user", "participant_profile"] as const;

export type PrivacySubjectKind = (typeof PRIVACY_SUBJECT_KINDS)[number];

export type FilingRefusal =
  | "not_your_child"
  | "guardian_not_verified"
  | "child_is_adult"
  | "erasure_needs_guardian"
  | "under_13_needs_guardian";

export type FilingDecision =
  | { ok: true; relation: RequestRelation; subjectKind: PrivacySubjectKind }
  | { ok: false; reason: FilingRefusal };

/**
 * May this requester file a request of `type` about `target`? Refusals
 * about a child check the link first, so nothing is said about a child the
 * requester isn't linked to.
 */
export function decideFiling(input: {
  type: PrivacyRequestType;
  /** Null when the requester has no own participant profile: an adult. */
  requesterAgeYears: number | null;
  target: FilingTarget;
}): FilingDecision {
  const { type, requesterAgeYears, target } = input;
  if (target.kind === "child") {
    if (target.guardian === "not_linked") {
      return { ok: false, reason: "not_your_child" };
    }
    if (target.guardian === "unverified") {
      return { ok: false, reason: "guardian_not_verified" };
    }
    if (target.childAgeYears >= ADULT_AGE) {
      return { ok: false, reason: "child_is_adult" };
    }
    return {
      ok: true,
      relation: "guardian",
      subjectKind: "participant_profile",
    };
  }
  if (requesterAgeYears !== null && requesterAgeYears < ADULT_AGE) {
    if (requesterAgeYears < OWN_LOGIN_MIN_AGE) {
      return { ok: false, reason: "under_13_needs_guardian" };
    }
    if (type === "erasure") {
      return { ok: false, reason: "erasure_needs_guardian" };
    }
  }
  return { ok: true, relation: "self", subjectKind: "user" };
}
