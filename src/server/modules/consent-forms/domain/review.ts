// Signed paper consent forms (#83). A coordinator uploads a scan of the
// form a guardian signed, as a private file, and records which public uses
// the guardian ticked. An FOA admin then accepts or rejects it. Only an
// accepted form counts as consent: nothing is recorded in the consent log
// until then.
//
// Pure: no database, no clock of its own. Loads under plain Node (the seed
// script), so relative imports only and no "server-only".

/** What the `consent_form_status` column holds. */
export const FORM_STATUSES = [
  "pending_review",
  "accepted",
  "rejected",
  "withdrawn",
] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

/** Why a reviewer rejects a form, as the coordinator is told. */
export const REJECTION_REASONS = [
  "illegible",
  "not_signed",
  "wrong_student",
  "wrong_competition",
  "uses_unclear",
  "other",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** The longest note a reviewer may add to a rejection. */
export const REJECTION_NOTE_MAX = 500;

/** The Files module's `file_asset_status` (#63). */
export type FileStatus =
  | "pending_upload"
  | "uploaded"
  | "scanning"
  | "clean"
  | "quarantined"
  | "rejected"
  | "deleted";

export type SubmitInput = {
  /** Public uses the guardian ticked, as the coordinator records them. */
  uses: readonly string[];
  /** Public uses this competition offers. */
  offered: readonly string[];
  fileStatus: FileStatus;
  /** Statuses of earlier forms for the same student and competition. */
  earlier: readonly FormStatus[];
};

export type SubmitDecision =
  | { ok: true; uses: string[] }
  | {
      ok: false;
      reason:
        | "no_uses"
        | "file_not_uploaded"
        | "file_unavailable"
        | "review_pending";
    }
  | { ok: false; reason: "not_offered"; uses: string[] };

export type ReviewAction =
  | { kind: "accept" }
  | { kind: "reject"; reason: string; note?: string | undefined };

export type ReviewInput = {
  form: { status: FormStatus; uploadedBy: string };
  reviewerId: string;
  fileStatus: FileStatus;
  now: Date;
};

export type ReviewDecision =
  | {
      ok: true;
      patch: {
        status: "accepted" | "rejected";
        reviewedBy: string;
        reviewedAt: Date;
        rejectionReason: RejectionReason | null;
        rejectionNote: string | null;
      };
    }
  | {
      ok: false;
      reason:
        | "not_pending"
        | "own_upload"
        | "file_not_clean"
        | "reason_required"
        | "note_required"
        | "note_too_long";
    };

export type WithdrawDecision =
  | { ok: true; patch: { status: "withdrawn" } }
  | { ok: false; reason: "not_pending" };

const UNAVAILABLE: ReadonlySet<FileStatus> = new Set([
  "quarantined",
  "rejected",
  "deleted",
]);

const isRejectionReason = (value: string): value is RejectionReason =>
  (REJECTION_REASONS as readonly string[]).includes(value);

/**
 * Whether a coordinator may submit a form for review. The scan needs to be
 * uploaded (the malware scan may still be running); one form waits for
 * review at a time per student and competition. A new form after an
 * accepted or rejected one is allowed: it corrects or adds to the record.
 * Ticked uses come back once each, in the offered order.
 */
export function decideSubmit(input: SubmitInput): SubmitDecision {
  if (input.fileStatus === "pending_upload") {
    return { ok: false, reason: "file_not_uploaded" };
  }
  if (UNAVAILABLE.has(input.fileStatus)) {
    return { ok: false, reason: "file_unavailable" };
  }
  if (input.earlier.includes("pending_review")) {
    return { ok: false, reason: "review_pending" };
  }
  const notOffered = [...new Set(input.uses)].filter(
    (use) => !input.offered.includes(use)
  );
  if (notOffered.length > 0) {
    return { ok: false, reason: "not_offered", uses: notOffered };
  }
  const uses = input.offered.filter((use) => input.uses.includes(use));
  if (uses.length === 0) return { ok: false, reason: "no_uses" };
  return { ok: true, uses };
}

/**
 * Whether a reviewer may accept or reject a form now. Accepting needs a
 * scan that passed the malware check; nobody reviews a form they uploaded.
 * A rejection names a reason, and "other" needs a note.
 */
export function decideReview(
  input: ReviewInput,
  action: ReviewAction
): ReviewDecision {
  if (input.form.status !== "pending_review") {
    return { ok: false, reason: "not_pending" };
  }
  if (input.form.uploadedBy === input.reviewerId) {
    return { ok: false, reason: "own_upload" };
  }
  const reviewed = { reviewedBy: input.reviewerId, reviewedAt: input.now };
  if (action.kind === "accept") {
    if (input.fileStatus !== "clean") {
      return { ok: false, reason: "file_not_clean" };
    }
    return {
      ok: true,
      patch: {
        status: "accepted",
        ...reviewed,
        rejectionReason: null,
        rejectionNote: null,
      },
    };
  }
  if (!isRejectionReason(action.reason)) {
    return { ok: false, reason: "reason_required" };
  }
  const note = action.note?.trim() ?? "";
  if (action.reason === "other" && note === "") {
    return { ok: false, reason: "note_required" };
  }
  if (note.length > REJECTION_NOTE_MAX) {
    return { ok: false, reason: "note_too_long" };
  }
  return {
    ok: true,
    patch: {
      status: "rejected",
      ...reviewed,
      rejectionReason: action.reason,
      rejectionNote: note === "" ? null : note,
    },
  };
}

/** A coordinator may take back a form only while it waits for review. */
export function decideWithdraw(form: { status: FormStatus }): WithdrawDecision {
  if (form.status !== "pending_review") {
    return { ok: false, reason: "not_pending" };
  }
  return { ok: true, patch: { status: "withdrawn" } };
}
