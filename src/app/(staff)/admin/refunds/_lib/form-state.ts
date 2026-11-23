// The refund forms' state between submissions (#80): what was typed (the
// form remounts after an action), a problem with a field, or an alert for
// the whole form. Pure, so it loads in the client forms and the Server
// Actions.

import type {
  ApproveRefundResult,
  RecordManualRefundResult,
  RejectRefundResult,
  RequestRefundResult,
  RetryRefundResult,
} from "@/server/modules/payments";

// --- Asking for a refund --------------------------------------------------

export type RequestFormState = {
  /** Counts submissions, so the form remounts with what was typed. */
  attempt: number;
  reason: string;
  registrationIds: string[];
  error?: "reason_required" | "reason_too_long";
  alert?:
    | "batch_not_captured"
    | "dashboard_managed"
    | "nothing_to_refund"
    | "item_in_live_refund"
    | "item_already_refunded"
    | "exceeds_paid"
    | "unexpected";
};

export const REQUEST_START: RequestFormState = {
  attempt: 0,
  reason: "",
  registrationIds: [],
};

/** The state after a request that didn't go through. */
export function afterRequest(
  previous: RequestFormState,
  entered: { reason: string; registrationIds: string[] },
  result: Exclude<RequestRefundResult, { ok: true }> | "unexpected"
): RequestFormState {
  const next = { attempt: previous.attempt + 1, ...entered };
  if (result === "unexpected") return { ...next, alert: "unexpected" };
  switch (result.error) {
    case "reason_required":
    case "reason_too_long":
      return { ...next, error: result.error };
    case "batch_not_captured":
    case "dashboard_managed":
    case "nothing_to_refund":
    case "exceeds_paid":
      return { ...next, alert: result.error };
    case "item_in_live_refund":
    case "item_already_refunded":
      // The page shows who is left: the choice no longer stands.
      return { ...next, registrationIds: [], alert: result.error };
    default:
      // invalid_input, not_found, empty, unknown or repeated students: the
      // page no longer matches the payment.
      return { ...next, alert: "unexpected" };
  }
}

// --- Deciding, retrying or closing a refund -------------------------------

export type DecisionFormState = {
  attempt: number;
  note: string;
  error?: "note_required" | "note_too_long";
  alert?:
    | "not_requested"
    | "not_rejectable"
    | "not_failed"
    | "same_person"
    | "unexpected";
};

export const DECISION_START: DecisionFormState = { attempt: 0, note: "" };

/** The state after a decision that didn't go through. */
export function afterDecision(
  previous: DecisionFormState,
  note: string,
  result:
    | Exclude<
        ApproveRefundResult | RejectRefundResult | RetryRefundResult,
        { ok: true }
      >
    | "unexpected"
): DecisionFormState {
  const next = { attempt: previous.attempt + 1, note };
  if (result === "unexpected") return { ...next, alert: "unexpected" };
  switch (result.error) {
    case "note_required":
    case "note_too_long":
      return { ...next, error: result.error };
    case "not_requested":
    case "not_rejectable":
    case "not_failed":
    case "same_person":
      return { ...next, alert: result.error };
    default:
      return { ...next, alert: "unexpected" };
  }
}

// --- Recording a manual refund --------------------------------------------

export type ManualFormState = {
  attempt: number;
  method: string;
  reference: string;
  error?: "reference_invalid";
  alert?: "not_approved" | "not_manual" | "same_person" | "unexpected";
};

export const MANUAL_START: ManualFormState = {
  attempt: 0,
  method: "bank_transfer",
  reference: "",
};

/** The state after a recording that didn't go through. */
export function afterManual(
  previous: ManualFormState,
  entered: { method: string; reference: string },
  result: Exclude<RecordManualRefundResult, { ok: true }> | "unexpected"
): ManualFormState {
  const next = { attempt: previous.attempt + 1, ...entered };
  if (result === "unexpected") return { ...next, alert: "unexpected" };
  switch (result.error) {
    case "reference_invalid":
      return { ...next, error: result.error };
    case "not_approved":
    case "not_manual":
    case "same_person":
      return { ...next, alert: result.error };
    default:
      return { ...next, alert: "unexpected" };
  }
}
