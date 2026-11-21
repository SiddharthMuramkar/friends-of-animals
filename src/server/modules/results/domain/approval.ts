// The people rules of a results release (#99): what may change while it is a
// draft, who submits it, and the two-person rule for approving and
// rejecting. Step-up re-authentication is checked by the access policy
// (#60), not here.
//
// Plain TypeScript, loads under plain Node.

import type { ResultsReleaseStatus } from "./release-status";

/** The longest note on how winners receive their prizes. */
export const DELIVERY_NOTE_MAX = 500;

/** The longest reason for rejecting or cancelling a release. */
export const REJECTION_REASON_MAX = 500;

type Decision<Refusal extends string> =
  | { ok: true }
  | { ok: false; reason: Refusal };

type ReasonDecision<Refusal extends string> =
  | { ok: true; reason: string }
  | { ok: false; reason: Refusal };

function isPast(at: Date, now: Date): boolean {
  return at.getTime() < now.getTime();
}

export type DraftEditRefusal =
  | "not_draft"
  | "publish_at_past"
  | "delivery_note_too_long";

/** Whether a draft may take this publish time and delivery note. */
export function decideDraftEdit(
  release: { status: ResultsReleaseStatus },
  edit: { publishAt: Date | null; deliveryNote: string | null },
  now: Date
): Decision<DraftEditRefusal> {
  if (release.status !== "draft") return { ok: false, reason: "not_draft" };
  if (edit.publishAt && isPast(edit.publishAt, now)) {
    return { ok: false, reason: "publish_at_past" };
  }
  if ((edit.deliveryNote?.length ?? 0) > DELIVERY_NOTE_MAX) {
    return { ok: false, reason: "delivery_note_too_long" };
  }
  return { ok: true };
}

export type SubmitRefusal =
  | "not_draft"
  | "not_preparer"
  | "publish_at_missing"
  | "publish_at_past";

/**
 * Whether `actorUserId` may send the draft for approval. Only the person who
 * prepared it may, so the approver is always somebody else.
 */
export function decideSubmit(
  release: {
    status: ResultsReleaseStatus;
    preparedBy: string;
    publishAt: Date | null;
  },
  actorUserId: string,
  now: Date
): Decision<SubmitRefusal> {
  if (release.status !== "draft") return { ok: false, reason: "not_draft" };
  if (release.preparedBy !== actorUserId) {
    return { ok: false, reason: "not_preparer" };
  }
  if (!release.publishAt) return { ok: false, reason: "publish_at_missing" };
  if (isPast(release.publishAt, now)) {
    return { ok: false, reason: "publish_at_past" };
  }
  return { ok: true };
}

export type ApprovalRefusal =
  | "own_results"
  | "not_pending"
  | "stale_snapshot"
  | "round_changed";

/**
 * Whether `actorUserId` may approve the release. The preparer never may.
 * The stored content must still match its hash, and the round's outcomes
 * must still match the snapshot (a re-tag after preparing needs a refresh,
 * which makes the refresher the preparer).
 */
export function decideApproval(
  release: {
    status: ResultsReleaseStatus;
    preparedBy: string;
    storedHash: string;
    contentHash: string;
    linesHash: string;
  },
  liveLinesHash: string,
  actorUserId: string
): Decision<ApprovalRefusal> {
  if (release.preparedBy === actorUserId) {
    return { ok: false, reason: "own_results" };
  }
  if (release.status !== "pending_approval") {
    return { ok: false, reason: "not_pending" };
  }
  if (release.storedHash !== release.contentHash) {
    return { ok: false, reason: "stale_snapshot" };
  }
  if (release.linesHash !== liveLinesHash) {
    return { ok: false, reason: "round_changed" };
  }
  return { ok: true };
}

type ReasonRefusal = "reason_required" | "reason_too_long";

function checkReason(raw: string): ReasonDecision<ReasonRefusal> {
  const reason = raw.trim();
  if (reason.length === 0) return { ok: false, reason: "reason_required" };
  if (reason.length > REJECTION_REASON_MAX) {
    return { ok: false, reason: "reason_too_long" };
  }
  return { ok: true, reason };
}

export type RejectionRefusal = "own_results" | "not_pending" | ReasonRefusal;

/**
 * Whether `actorUserId` may reject the release with `reason` (trimmed on
 * success). Like approval, never the preparer.
 */
export function decideRejection(
  release: { status: ResultsReleaseStatus; preparedBy: string },
  actorUserId: string,
  reason: string
): ReasonDecision<RejectionRefusal> {
  if (release.preparedBy === actorUserId) {
    return { ok: false, reason: "own_results" };
  }
  if (release.status !== "pending_approval") {
    return { ok: false, reason: "not_pending" };
  }
  return checkReason(reason);
}

export type CancelRefusal = "not_approved" | ReasonRefusal;

/**
 * Whether an approved release that hasn't been published may be stopped,
 * with `reason` (trimmed on success). Stopping only ever keeps results from
 * going public, so the preparer may do it too.
 */
export function decideCancel(
  release: { status: ResultsReleaseStatus },
  reason: string
): ReasonDecision<CancelRefusal> {
  if (release.status !== "approved") {
    return { ok: false, reason: "not_approved" };
  }
  return checkReason(reason);
}
