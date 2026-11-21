// The institution status machine (#73). An institution starts pending
// verification; FOA staff verify, reject or suspend it, always with a
// reason. A suspended institution is reinstated by verifying it again and
// keeps its Institution ID. Rejected is final: the authorised person
// registers the institution again.
//
// Loads under plain Node (schema, seed script), so no "server-only" here.

/** In the order an institution usually meets them. */
export const INSTITUTION_STATUSES = [
  "pending_verification",
  "verified",
  "rejected",
  "suspended",
] as const;

export type InstitutionStatus = (typeof INSTITUTION_STATUSES)[number];

/** What FOA staff can decide about an institution. */
export const INSTITUTION_DECISIONS = ["verify", "reject", "suspend"] as const;

export type InstitutionDecision = (typeof INSTITUTION_DECISIONS)[number];

/** What the authorised person is told. */
export type InstitutionOutcome =
  | "verified"
  | "rejected"
  | "suspended"
  | "reinstated";

type Move = { to: InstitutionStatus; outcome: InstitutionOutcome };

/** Every allowed move. A decision missing from a status is refused. */
const TRANSITIONS: Record<
  InstitutionStatus,
  Partial<Record<InstitutionDecision, Move>>
> = {
  pending_verification: {
    verify: { to: "verified", outcome: "verified" },
    reject: { to: "rejected", outcome: "rejected" },
  },
  verified: {
    suspend: { to: "suspended", outcome: "suspended" },
  },
  rejected: {},
  suspended: {
    verify: { to: "verified", outcome: "reinstated" },
  },
};

export const DECISION_REASON_MAX_LENGTH = 1000;

export type InstitutionStatusChange =
  | {
      ok: true;
      to: InstitutionStatus;
      outcome: InstitutionOutcome;
      /** True on the first verification, which gives the Institution ID. */
      issuesInstitutionCode: boolean;
      /** Trimmed, as stored and shown. */
      reason: string;
    }
  | {
      ok: false;
      error: "transition_not_allowed" | "reason_required" | "reason_too_long";
    };

/** Where `decision` takes an institution in status `from`, if anywhere. */
export function decideInstitutionStatus(input: {
  from: InstitutionStatus;
  decision: InstitutionDecision;
  reason: string;
}): InstitutionStatusChange {
  const move = TRANSITIONS[input.from][input.decision];
  if (!move) return { ok: false, error: "transition_not_allowed" };
  const reason = input.reason.trim();
  if (reason === "") return { ok: false, error: "reason_required" };
  if (reason.length > DECISION_REASON_MAX_LENGTH) {
    return { ok: false, error: "reason_too_long" };
  }
  return {
    ok: true,
    ...move,
    issuesInstitutionCode:
      input.from === "pending_verification" && move.to === "verified",
    reason,
  };
}
