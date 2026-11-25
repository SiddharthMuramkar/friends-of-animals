// The two-approver rule for money operations (#109). Chosen operations
// don't run when a finance user asks for them: they wait as a pending
// request until a second, different finance user approves (with step-up),
// and the operation then runs in the approver's transaction. Pure: the
// caller checks the finance role and step-up, loads the request and passes
// the time in.
//
// Loads under plain Node (the schema builds its enum from
// FINANCE_APPROVAL_STATUSES and the settings catalogue reads the defaults):
// no imports at all.

export const FINANCE_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
] as const;

export type FinanceApprovalStatus = (typeof FINANCE_APPROVAL_STATUSES)[number];

/** Every allowed change, `null` being "no row yet". Nothing else is allowed. */
export const FINANCE_APPROVAL_TRANSITIONS: readonly {
  from: FinanceApprovalStatus | null;
  to: FinanceApprovalStatus;
}[] = [
  { from: null, to: "pending" },
  { from: "pending", to: "approved" },
  { from: "pending", to: "rejected" },
  { from: "pending", to: "cancelled" },
  { from: "pending", to: "expired" },
];

export function canTransitionFinanceApproval(
  from: FinanceApprovalStatus | null,
  to: FinanceApprovalStatus
): boolean {
  return FINANCE_APPROVAL_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to
  );
}

export class FinanceApprovalTransitionError extends Error {
  constructor(
    readonly from: FinanceApprovalStatus | null,
    readonly to: FinanceApprovalStatus
  ) {
    super(`Finance approval can't go ${from ?? "none"} -> ${to}`);
    this.name = "FinanceApprovalTransitionError";
  }
}

export function assertFinanceApprovalTransition(
  from: FinanceApprovalStatus | null,
  to: FinanceApprovalStatus
): void {
  if (!canTransitionFinanceApproval(from, to)) {
    throw new FinanceApprovalTransitionError(from, to);
  }
}

/**
 * The operations the rule covers. Stored as text, not an enum, so a later
 * money operation joins without a migration.
 */
export const FINANCE_OPERATIONS = [
  "period_lock",
  "period_unlock",
  "manual_entry",
] as const;

export type FinanceOperation = (typeof FINANCE_OPERATIONS)[number];

/**
 * Rs 50,000: a manual entry moving more than this needs a second approver.
 * The runtime setting `ledger.manualEntryApprovalThresholdRupees` holds it
 * in whole rupees (HR-51).
 */
export const DEFAULT_MANUAL_ENTRY_APPROVAL_THRESHOLD_RUPEES = 50_000;

/** A pending request nobody decides expires after this many days (HR-51). */
export const DEFAULT_APPROVAL_EXPIRY_DAYS = 7;

/** A threshold in whole rupees as paise. */
export function thresholdMinor(rupees: number): bigint {
  if (!Number.isSafeInteger(rupees) || rupees < 0) {
    throw new RangeError(`Not a whole number of rupees: ${rupees}`);
  }
  return BigInt(rupees) * 100n;
}

/**
 * Whether the operation waits for a second approver. A lock or unlock
 * always does; a manual entry does when it moves more than the threshold.
 */
export function needsSecondApprover(
  input:
    | { operation: "period_lock" | "period_unlock" }
    | { operation: "manual_entry"; totalMinor: bigint; thresholdMinor: bigint }
): boolean {
  if (input.operation !== "manual_entry") return true;
  return input.totalMinor > input.thresholdMinor;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a request made at `requestedAt` stops accepting decisions. */
export function approvalExpiresAt(requestedAt: Date, expiryDays: number): Date {
  if (!Number.isInteger(expiryDays) || expiryDays < 1) {
    throw new RangeError(
      `Approval expiry must be a whole number of days, at least 1: ${expiryDays}`
    );
  }
  return new Date(requestedAt.getTime() + expiryDays * DAY_MS);
}

export type PendingRequest = {
  status: FinanceApprovalStatus;
  requestedByUserId: string;
  /** Set when it was requested (`approvalExpiresAt`), so a later change to the setting doesn't move it. */
  expiresAt: Date;
};

export type FinanceDecision =
  | { kind: "approve"; byUserId: string }
  | { kind: "reject"; byUserId: string; reason: string }
  | { kind: "cancel"; byUserId: string }
  /** The expiry job. */
  | { kind: "expire" };

export type FinanceDecisionRefusal =
  /** Already approved, rejected, cancelled or expired. */
  | "not_pending"
  /** The requester tried to approve or reject their own request. */
  | "self_approval"
  /** Only the requester may cancel. */
  | "not_requester"
  /** A rejection needs a reason. */
  | "reason_required"
  /** The expiry window has passed; the job will mark it expired. */
  | "request_expired"
  /** The expiry job ran before the window passed. */
  | "not_due";

export type FinanceDecisionResult =
  | { ok: true; to: FinanceApprovalStatus }
  | { ok: false; reason: FinanceDecisionRefusal };

/**
 * Whether `decision` may be applied to `request` at `now`, and the status
 * it moves to. A request past its window counts as expired even before the
 * expiry job runs, so nothing is approved late.
 */
export function decideFinanceApproval(input: {
  request: PendingRequest;
  decision: FinanceDecision;
  now: Date;
}): FinanceDecisionResult {
  const { request, decision, now } = input;
  if (request.status !== "pending") return { ok: false, reason: "not_pending" };

  const expired = now.getTime() >= request.expiresAt.getTime();

  if (decision.kind === "expire") {
    return expired
      ? { ok: true, to: "expired" }
      : { ok: false, reason: "not_due" };
  }
  if (expired) return { ok: false, reason: "request_expired" };

  const byRequester = decision.byUserId === request.requestedByUserId;
  switch (decision.kind) {
    case "approve":
      return byRequester
        ? { ok: false, reason: "self_approval" }
        : { ok: true, to: "approved" };
    case "reject":
      if (byRequester) return { ok: false, reason: "self_approval" };
      return decision.reason.trim() === ""
        ? { ok: false, reason: "reason_required" }
        : { ok: true, to: "rejected" };
    case "cancel":
      return byRequester
        ? { ok: true, to: "cancelled" }
        : { ok: false, reason: "not_requester" };
  }
}
