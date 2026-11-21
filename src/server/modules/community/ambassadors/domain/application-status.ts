// The ambassador application status machine (#122). A member applies; a
// community manager approves or declines it (declining needs a reason the
// applicant is told), or the applicant withdraws it. Every decision closes
// the application, and a closed application never reopens: the member
// applies again with a new one.
//
// Approval is checked against the applicant's eligibility at that moment,
// so someone who left the community after applying isn't made an
// ambassador; the community manager declines instead.
//
// Pure. Loads under plain Node (the schema builds its pgEnum from the
// statuses below), so no "server-only" and no "@/" imports.

/** In the order an application meets them. */
export const AMBASSADOR_APPLICATION_STATUSES = [
  "submitted",
  "approved",
  "declined",
  "withdrawn",
] as const;

export type AmbassadorApplicationStatus =
  (typeof AMBASSADOR_APPLICATION_STATUSES)[number];

/** Approve and decline are the community manager's; withdraw the applicant's. */
export const AMBASSADOR_DECISIONS = ["approve", "decline", "withdraw"] as const;

export type AmbassadorDecision = (typeof AMBASSADOR_DECISIONS)[number];

/** Every allowed move. A decision missing from a status is refused. */
const TRANSITIONS: Record<
  AmbassadorApplicationStatus,
  Partial<Record<AmbassadorDecision, AmbassadorApplicationStatus>>
> = {
  submitted: {
    approve: "approved",
    decline: "declined",
    withdraw: "withdrawn",
  },
  approved: {},
  declined: {},
  withdrawn: {},
};

/** The decisions an application in `status` can still take. */
export function allowedDecisions(
  status: AmbassadorApplicationStatus
): AmbassadorDecision[] {
  return AMBASSADOR_DECISIONS.filter(
    (decision) => TRANSITIONS[status][decision] !== undefined
  );
}

/** Whether the application still waits for a decision. */
export function isOpenApplication(
  status: AmbassadorApplicationStatus
): boolean {
  return allowedDecisions(status).length > 0;
}

export const DECISION_REASON_MAX_LENGTH = 1000;

/** Characters, counting an emoji or other astral character once. */
const length = (text: string) => Array.from(text).length;

export type AmbassadorApplicationChange =
  | {
      ok: true;
      to: AmbassadorApplicationStatus;
      /** True on approval: the applicant reaches the ambassador rung. */
      recordsMilestone: boolean;
      /** True when the applicant gets a message about the decision. */
      notifiesApplicant: boolean;
      /** The decline reason, trimmed, as stored and shown; else null. */
      reason: string | null;
    }
  | {
      ok: false;
      error:
        | "transition_not_allowed"
        | "no_longer_eligible"
        | "reason_required"
        | "reason_too_long";
    };

/**
 * Where `decision` takes an application in status `from`, if anywhere.
 * `eligibleNow` is the eligibility check run for approval at the moment of
 * deciding; only approval reads it. `reason` is read only when declining.
 */
export function decideAmbassadorApplication(input: {
  from: AmbassadorApplicationStatus;
  decision: AmbassadorDecision;
  reason: string;
  eligibleNow: boolean;
}): AmbassadorApplicationChange {
  const to = TRANSITIONS[input.from][input.decision];
  if (to === undefined) return { ok: false, error: "transition_not_allowed" };

  switch (input.decision) {
    case "approve":
      if (!input.eligibleNow) return { ok: false, error: "no_longer_eligible" };
      return {
        ok: true,
        to,
        recordsMilestone: true,
        notifiesApplicant: true,
        reason: null,
      };
    case "decline": {
      const reason = input.reason.trim();
      if (reason === "") return { ok: false, error: "reason_required" };
      if (length(reason) > DECISION_REASON_MAX_LENGTH) {
        return { ok: false, error: "reason_too_long" };
      }
      return {
        ok: true,
        to,
        recordsMilestone: false,
        notifiesApplicant: true,
        reason,
      };
    }
    case "withdraw":
      return {
        ok: true,
        to,
        recordsMilestone: false,
        notifiesApplicant: false,
        reason: null,
      };
  }
}
