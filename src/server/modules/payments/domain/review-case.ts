// Payments needing review (#79). When the gateway captures money that can't
// be accepted for a batch's registrations, nothing is confirmed and nothing
// is refunded automatically: the batch moves to `needs_review` and a review
// case opens for that captured payment. Staff then resolve the case with an
// outcome and a reason. Two decisions live here, both pure:
//
// - `reviewReasonFor`: does a capture land, or why not? The capture funnel
//   asks it for every signal (Checkout return, webhook, sweep), so they all
//   behave the same.
// - `planResolution`: what resolving a case does to its batch.
//
// No imports, so the schema's enums can be built from these lists.

/**
 * Why a captured payment wasn't accepted, in precedence order: when several
 * apply, the first is recorded. The two that rule out confirming come first,
 * so a case only names a confirmable reason when confirming is possible.
 */
export const PAYMENT_REVIEW_REASONS = [
  /** A registration is already confirmed: this money is a second payment. */
  "already_paid",
  /** A registration was withdrawn or cancelled after the order was made. */
  "registration_cancelled",
  /** The captured amount or currency isn't the batch's. */
  "amount_mismatch",
  /** The competition stopped taking registrations before the capture. */
  "registration_closed",
  /** The payer started a newer batch over these registrations, which now
   * holds them, so this batch's order should no longer have been paid. */
  "batch_superseded",
  /** A full payment arrived while the batch's earlier one was in review,
   * and nothing rules it out (#80, from #79's review): staff may accept it
   * once the other case is resolved. Never from `reviewReasonFor`: the
   * capture funnel picks it when that finds nothing wrong. */
  "paid_while_in_review",
  /** A guardian must give consent on the attached participation version. */
  "participation_consent_required",
  /** A donation's money arrived after the donation expired (#106): staff
   * may accept it, which captures the donation with its receipt. */
  "donation_expired",
] as const;

export type PaymentReviewReason = (typeof PAYMENT_REVIEW_REASONS)[number];

/** One registration a capture would confirm, as the funnel reads it. */
export type RegistrationAtCapture = {
  registrationId: string;
  /** From the registration's status: still unpaid, confirmed (by this
   * batch or another), or withdrawn or cancelled. */
  standing: "awaiting_payment" | "paid" | "cancelled";
  /** Whether its competition still takes registrations at the capture
   * instant (status open and the close not yet passed). */
  windowOpen: boolean;
  /** Whether this batch's item for it still holds it (not released). */
  heldByThisBatch: boolean;
};

/**
 * Null when the capture can confirm the batch's registrations; otherwise why
 * the batch goes to review instead. A batch with nothing left to confirm is
 * treated as superseded.
 */
export function reviewReasonFor(capture: {
  amountMatches: boolean;
  registrations: readonly RegistrationAtCapture[];
}): PaymentReviewReason | null {
  const { amountMatches, registrations } = capture;
  const any = (test: (registration: RegistrationAtCapture) => boolean) =>
    registrations.some(test);

  if (any((registration) => registration.standing === "paid")) {
    return "already_paid";
  }
  if (any((registration) => registration.standing === "cancelled")) {
    return "registration_cancelled";
  }
  if (!amountMatches) return "amount_mismatch";
  if (any((registration) => !registration.windowOpen)) {
    return "registration_closed";
  }
  if (
    registrations.length === 0 ||
    any((registration) => !registration.heldByThisBatch)
  ) {
    return "batch_superseded";
  }
  return null;
}

/** How staff resolve a case. None of them calls the gateway here. */
export const PAYMENT_REVIEW_OUTCOMES = [
  /** Accept the money: confirm the registrations as a capture would. */
  "confirm",
  /** Give the money back: the refunds ticket (#80) acts on `refundDue`. */
  "refund",
  /** No money moves through the platform, e.g. it was settled outside it.
   * The reason must say how. */
  "keep",
] as const;

export type PaymentReviewOutcome = (typeof PAYMENT_REVIEW_OUTCOMES)[number];

/**
 * The batch statuses a case can open from. A second case on a batch already
 * in review copies the first case's status, so `needs_review` is never one.
 */
export const BATCH_STATUSES_BEFORE_REVIEW = [
  "created",
  "order_created",
  "captured",
  "failed",
  "cancelled",
] as const;

export type BatchStatusBeforeReview =
  (typeof BATCH_STATUSES_BEFORE_REVIEW)[number];

/**
 * The batch events resolving a case can cause. The batch's transition table
 * maps them from `needs_review`: confirmed and cleared to `captured`,
 * dismissed to `cancelled`.
 */
export type ReviewBatchEvent =
  | "review_confirmed"
  | "review_cleared"
  | "review_dismissed";

const CONFIRMABLE: ReadonlySet<PaymentReviewReason> = new Set([
  "amount_mismatch",
  "registration_closed",
  "batch_superseded",
  "paid_while_in_review",
  "participation_consent_required",
]);

/** A donation's batch (#106) confirms only late money for its amount: any
 * other confirmation would turn a different sum into the donation. */
const DONATION_CONFIRMABLE: ReadonlySet<PaymentReviewReason> = new Set([
  "donation_expired",
]);

/**
 * What staff may choose for a case. Confirming needs registrations that can
 * still be confirmed, and a batch that hasn't already confirmed them.
 */
export function allowedOutcomes(reviewCase: {
  reason: PaymentReviewReason;
  batchStatusBefore: BatchStatusBeforeReview;
  currency: string;
  amountMinor: bigint;
  /** What the batch pays for; registration fees unless said. */
  purpose?: "registration_fee" | "donation" | "auction_sale";
}): readonly PaymentReviewOutcome[] {
  if (reviewCase.purpose === "auction_sale") return ["refund", "keep"];
  const reasons =
    reviewCase.purpose === "donation" ? DONATION_CONFIRMABLE : CONFIRMABLE;
  const confirmable =
    reasons.has(reviewCase.reason) &&
    reviewCase.batchStatusBefore !== "captured" &&
    reviewCase.currency === "INR" &&
    reviewCase.amountMinor > 0n;
  return confirmable ? ["confirm", "refund", "keep"] : ["refund", "keep"];
}

const graphemes = new Intl.Segmenter("en-IN", { granularity: "grapheme" });

/** Characters as a reader counts them: "हु" is one, though two code points. */
export function characterCount(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(text)) count += 1;
  return count;
}

/** A resolution reason is a sentence, not a tick: at least this long. */
export const RESOLUTION_REASON_MIN_LENGTH = 10;
export const RESOLUTION_REASON_MAX_LENGTH = 2000;

export type ResolutionRefusal =
  | "already_resolved"
  | "outcome_not_allowed"
  | "resolve_other_cases_first"
  | "reason_required"
  | "reason_too_long";

export type ResolutionPlan =
  | {
      ok: true;
      outcome: PaymentReviewOutcome;
      /** Trimmed, as it is stored. */
      resolutionReason: string;
      /** What happens to the batch; null while another case keeps it in
       * review. */
      batchEvent: ReviewBatchEvent | null;
      /** Confirm the registrations through the capture path. */
      confirmsRegistrations: boolean;
      /** The refunds ticket owes the payer this payment back. */
      refundDue: boolean;
    }
  | { ok: false; refusal: ResolutionRefusal };

/**
 * What resolving `reviewCase` with `outcome` does. The batch leaves review
 * when its last open case is resolved: to `captured` if the money is
 * accepted or the batch was paid before review, else to `cancelled`, which
 * releases its registrations so the payer can start again.
 */
export function planResolution(input: {
  reviewCase: {
    reason: PaymentReviewReason;
    batchStatusBefore: BatchStatusBeforeReview;
    currency: string;
    amountMinor: bigint;
    resolvedAt: Date | null;
    purpose?: "registration_fee" | "donation" | "auction_sale";
  };
  outcome: PaymentReviewOutcome;
  resolutionReason: string;
  /** Other unresolved cases on the same batch. */
  otherOpenCases: number;
}): ResolutionPlan {
  const { reviewCase, outcome, otherOpenCases } = input;
  if (reviewCase.resolvedAt !== null) {
    return { ok: false, refusal: "already_resolved" };
  }
  if (!allowedOutcomes(reviewCase).includes(outcome)) {
    return { ok: false, refusal: "outcome_not_allowed" };
  }
  if (outcome === "confirm" && otherOpenCases > 0) {
    return { ok: false, refusal: "resolve_other_cases_first" };
  }

  const resolutionReason = input.resolutionReason.trim();
  const length = characterCount(resolutionReason);
  if (length < RESOLUTION_REASON_MIN_LENGTH) {
    return { ok: false, refusal: "reason_required" };
  }
  if (length > RESOLUTION_REASON_MAX_LENGTH) {
    return { ok: false, refusal: "reason_too_long" };
  }

  let batchEvent: ReviewBatchEvent | null = null;
  if (otherOpenCases === 0) {
    if (outcome === "confirm") batchEvent = "review_confirmed";
    else if (reviewCase.batchStatusBefore === "captured") {
      batchEvent = "review_cleared";
    } else batchEvent = "review_dismissed";
  }

  return {
    ok: true,
    outcome,
    resolutionReason,
    batchEvent,
    confirmsRegistrations: outcome === "confirm",
    refundDue: outcome === "refund",
  };
}
