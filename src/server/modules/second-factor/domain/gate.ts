// The staff two-factor gate and step-up, as one decision. The use cases
// load who is acting (their roles, from #59) and this session's second
// factor, then ask:
//
//   - "staff": may this user open staff screens and run staff use cases?
//     Users without a staff role always may. Staff must have enrolled a
//     factor (TOTP or a passkey) and passed it in this session.
//   - "step-up": may this user run a sensitive action (granting a role,
//     publishing results, moving money, exporting data) now? Only with a
//     second factor passed within the step-up window.
//
// Pure: no I/O, time comes in as `now`.

/** The FOA staff roles. Holding any of them, in any scope, makes a user staff. */
export const STAFF_ROLES = [
  "staff_admin",
  "super_admin",
  "competition_manager",
  "content_manager",
  "community_manager",
  "finance",
  "auction_manager",
  "adoption_coordinator",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** How long a passed second factor counts for step-up (HR-19 default). */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

/** Where a user stands with their second factor, in the current session. */
export type SecondFactorStatus = {
  /** Holds at least one TOTP authenticator or passkey. */
  enrolled: boolean;
  /** When this session last passed a second factor; null if it never did. */
  verifiedAt: Date | null;
};

export type SecondFactorRequirement = "staff" | "step-up";

export type SecondFactorRefusal =
  /** Set up an authenticator app or a passkey first. */
  | "enrolment_required"
  /** Enter the second factor for this session. */
  | "second_factor_required"
  /** Enter the second factor again: the last one is too old. */
  | "step_up_required";

export type SecondFactorDecision =
  | { ok: true }
  | { ok: false; code: SecondFactorRefusal };

export function checkSecondFactor(input: {
  requirement: SecondFactorRequirement;
  /** Role names the user holds, in any scope. */
  roles: readonly string[];
  status: SecondFactorStatus;
  now: Date;
  stepUpWindowMs?: number;
}): SecondFactorDecision {
  const { requirement, status, now } = input;
  if (requirement === "staff" && !input.roles.some(isStaffRole)) {
    return { ok: true };
  }
  if (!status.enrolled) return { ok: false, code: "enrolment_required" };
  if (requirement === "staff") {
    return status.verifiedAt
      ? { ok: true }
      : { ok: false, code: "second_factor_required" };
  }
  const window = input.stepUpWindowMs ?? STEP_UP_WINDOW_MS;
  const age = status.verifiedAt
    ? now.getTime() - status.verifiedAt.getTime()
    : Number.NaN;
  // NaN (never verified) and a future stamp both fail this check.
  return age >= 0 && age <= window
    ? { ok: true }
    : { ok: false, code: "step_up_required" };
}
