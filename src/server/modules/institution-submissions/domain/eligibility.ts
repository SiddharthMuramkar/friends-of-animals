// Which students a coordinator may submit entries for. Entries' submit
// use cases ask this when the actor is acting for an institution; the
// coordinator dashboard asks it to show which students can still get an
// entry. Pure: the caller loads the registration and the actor's
// institution scope.
//
// Loads under plain Node, so no "server-only" here.

/** What eligibility needs to know about one student's registration. */
export type StudentRegistration = {
  route: "institution" | "individual";
  /** The institution the student enrolled through; null on the individual route. */
  institutionId: string | null;
  /** Confirmed once the fee is paid (or the competition is free). */
  confirmed: boolean;
};

/** The institutions the actor coordinates for. */
export type CoordinatorScope = {
  institutionIds: readonly string[];
};

/**
 * Why a coordinator may not submit. Use cases report `other_institution` and
 * `not_school_route` as `forbidden`, so a refusal reveals nothing about
 * students outside the coordinator's institution.
 */
export type SubmitRefusal =
  | "not_school_route"
  | "other_institution"
  | "not_confirmed";

export type SubmitDecision =
  | { ok: true }
  | { ok: false; reason: SubmitRefusal };

/**
 * A coordinator may submit for a student only on the school route, only
 * through an institution they coordinate for, and only once the enrolment
 * is confirmed. Scope is checked before status.
 */
export function coordinatorMaySubmit(
  registration: StudentRegistration,
  scope: CoordinatorScope
): SubmitDecision {
  if (registration.route !== "institution") {
    return { ok: false, reason: "not_school_route" };
  }
  if (
    registration.institutionId === null ||
    !scope.institutionIds.includes(registration.institutionId)
  ) {
    return { ok: false, reason: "other_institution" };
  }
  if (!registration.confirmed) {
    return { ok: false, reason: "not_confirmed" };
  }
  return { ok: true };
}
