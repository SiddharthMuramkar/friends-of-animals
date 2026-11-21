// FOA verification rules for digital entries (#92): what a verifier's
// decision, a resubmission, a resubmitted file going live or the submission
// deadline does to one entry. Pure: the use cases load the entry, call
// `decide`, then write the transition, the verification record, the audit
// row and the outbox event it names. Nothing here reads the database, the
// clock or the settings; `now` and the resubmission days come in.
//
// Owner decision on #92: there is no separate "resubmitted" state.
// Resubmitting returns the entry to `submitted_to_foa` and the history is
// kept. The resubmission deadline is the send-back time plus N days, a
// runtime setting (default 7). Once it passes, the entry stays `sent_back`.
//
// Loads under plain Node: no "server-only", no `@/` imports.

/** The preset reasons a verifier picks from, in display order. */
export const SEND_BACK_REASON_CODES = [
  "file_unreadable",
  "wrong_work",
  "missing_declaration",
  "other",
] as const;

export type SendBackReasonCode = (typeof SEND_BACK_REASON_CODES)[number];

/** The longest note a verifier can add to a reason, in characters. */
export const SEND_BACK_REASON_TEXT_MAX = 500;

/** Bounds of the `entries.resubmission_days` setting. */
export const RESUBMISSION_DAYS = { default: 7, min: 1, max: 60 } as const;

export type SendBackReason = {
  code: SendBackReasonCode;
  /** Trimmed; null when the verifier added no note. Required for "other". */
  text: string | null;
};

/** What `decide` needs to know about the entry. */
export type VerificationState = {
  /** The entry's current status: any `entry_status` value. */
  status: string;
  /** When the latest send-back's window closes. Set exactly when sent back. */
  resubmissionDueAt: Date | null;
  /** A resubmission with a new file is waiting for that file to go live. */
  resubmissionPending: boolean;
};

export type VerificationCommand =
  /** A verifier marks the entry verified. */
  | { kind: "verify" }
  /** A verifier sends the entry back with a reason. */
  | {
      kind: "send_back";
      /** Unparsed, as the form sent it. */
      reason: { code?: unknown; text?: unknown };
      /** The `entries.resubmission_days` setting at decision time. */
      resubmissionDays: number;
    }
  /** The participant, guardian or coordinator resubmits a sent-back entry. */
  | { kind: "resubmit"; withNewFile: boolean }
  /** The file a resubmission uploaded passed scan and processing. */
  | { kind: "replacement_live" }
  /** The submission deadline job, or an entry submitted after it. */
  | {
      kind: "forward";
      route: "school" | "individual";
      submissionClosesAt: Date;
    };

export type VerificationEvent =
  | "entry.foa_verified"
  | "entry.sent_back"
  | "entry.resubmitted";

export type VerificationRefusal =
  | "already_verified"
  | "awaiting_resubmission"
  | "not_awaiting_verification"
  | "reason_required"
  | "reason_text_required"
  | "reason_text_too_long"
  | "not_sent_back"
  | "resubmission_closed"
  | "no_resubmission_pending"
  | "submission_still_open"
  | "school_route"
  | "not_submitted";

export type VerificationDecision =
  | { ok: true; to: "foa_verified"; event: "entry.foa_verified" }
  | {
      ok: true;
      to: "sent_back";
      event: "entry.sent_back";
      reason: SendBackReason;
      resubmissionDueAt: Date;
    }
  | {
      ok: true;
      to: "submitted_to_foa";
      /** Null when an individual entry is forwarded at the deadline. */
      event: "entry.resubmitted" | null;
    }
  /** Accepted, but the entry stays where it is: a new file is on its way. */
  | { ok: true; to: null; event: null }
  | { ok: false; code: VerificationRefusal };

const AWAITING = "submitted_to_foa";
const VERIFIED = "foa_verified";
const SENT_BACK = "sent_back";

const DAY_MS = 24 * 60 * 60 * 1000;

function refuse(code: VerificationRefusal): VerificationDecision {
  return { ok: false, code };
}

/** Why a verifier can't decide on an entry in this status, if they can't. */
function decisionRefusal(status: string): VerificationRefusal | null {
  if (status === AWAITING) return null;
  if (status === VERIFIED) return "already_verified";
  if (status === SENT_BACK) return "awaiting_resubmission";
  return "not_awaiting_verification";
}

function isReasonCode(value: unknown): value is SendBackReasonCode {
  return (SEND_BACK_REASON_CODES as readonly unknown[]).includes(value);
}

function parseReason(input: {
  code?: unknown;
  text?: unknown;
}): SendBackReason | VerificationRefusal {
  if (!isReasonCode(input.code)) return "reason_required";
  if (input.text !== undefined && typeof input.text !== "string") {
    return "reason_required";
  }
  const text = input.text?.trim() ?? "";
  if (text.length > SEND_BACK_REASON_TEXT_MAX) return "reason_text_too_long";
  if (input.code === "other" && text === "") return "reason_text_required";
  return { code: input.code, text: text === "" ? null : text };
}

function assertResubmissionDays(days: number): void {
  if (
    !Number.isInteger(days) ||
    days < RESUBMISSION_DAYS.min ||
    days > RESUBMISSION_DAYS.max
  ) {
    throw new RangeError(
      `Resubmission days must be a whole number from ${RESUBMISSION_DAYS.min} to ${RESUBMISSION_DAYS.max}, got ${days}`
    );
  }
}

/**
 * What `command` does to an entry in `state` at `now`: the status it moves
 * to and the event to emit, or why it is refused. Throws only on input the
 * schema and the settings registry never produce.
 */
export function decide(
  state: VerificationState,
  command: VerificationCommand,
  now: Date
): VerificationDecision {
  switch (command.kind) {
    case "verify": {
      const refusal = decisionRefusal(state.status);
      if (refusal) return refuse(refusal);
      return { ok: true, to: VERIFIED, event: "entry.foa_verified" };
    }

    case "send_back": {
      assertResubmissionDays(command.resubmissionDays);
      const refusal = decisionRefusal(state.status);
      if (refusal) return refuse(refusal);
      const reason = parseReason(command.reason);
      if (typeof reason === "string") return refuse(reason);
      return {
        ok: true,
        to: SENT_BACK,
        event: "entry.sent_back",
        reason,
        resubmissionDueAt: new Date(
          now.getTime() + command.resubmissionDays * DAY_MS
        ),
      };
    }

    case "resubmit": {
      if (state.status === VERIFIED) return refuse("already_verified");
      if (state.status !== SENT_BACK) return refuse("not_sent_back");
      if (!state.resubmissionDueAt) {
        throw new TypeError(
          "A sent-back entry must have a resubmission deadline"
        );
      }
      if (now.getTime() >= state.resubmissionDueAt.getTime()) {
        return refuse("resubmission_closed");
      }
      if (command.withNewFile) return { ok: true, to: null, event: null };
      return { ok: true, to: AWAITING, event: "entry.resubmitted" };
    }

    case "replacement_live": {
      // The deadline is not checked again: the resubmission was accepted
      // before it, and the file only finished processing afterwards.
      if (state.status !== SENT_BACK || !state.resubmissionPending) {
        return refuse("no_resubmission_pending");
      }
      return { ok: true, to: AWAITING, event: "entry.resubmitted" };
    }

    case "forward": {
      if (command.route === "school") return refuse("school_route");
      if (state.status !== "submitted") return refuse("not_submitted");
      if (now.getTime() < command.submissionClosesAt.getTime()) {
        return refuse("submission_still_open");
      }
      return { ok: true, to: AWAITING, event: null };
    }
  }
}
