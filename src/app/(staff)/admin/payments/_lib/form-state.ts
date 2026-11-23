// The payments admin forms' state between submissions (#79): what was
// typed (the form remounts after an action), a problem with a field, or an
// alert for the whole form. Pure, so it loads in the client forms and the
// Server Actions.

import type {
  RecordOfflinePaymentResult,
  ResolvePaymentReviewCaseResult,
} from "@/server/modules/payments";

// --- Resolving a payment in review ---------------------------------------

export type ResolveFormState = {
  /** Counts submissions, so the form remounts with the reason below. */
  attempt: number;
  reason: string;
  error?: "reason_required" | "reason_too_long";
  alert?:
    | "outcome_not_allowed"
    | "resolve_other_cases_first"
    | "registration_not_payable"
    | "already_resolved"
    | "unexpected";
};

export const RESOLVE_START: ResolveFormState = { attempt: 0, reason: "" };

/** The state after a resolution that didn't go through. */
export function afterResolve(
  previous: ResolveFormState,
  reason: string,
  result: Exclude<ResolvePaymentReviewCaseResult, { ok: true }> | "unexpected"
): ResolveFormState {
  const attempt = previous.attempt + 1;
  if (result === "unexpected") return { attempt, reason, alert: "unexpected" };
  switch (result.error) {
    case "reason_required":
    case "reason_too_long":
      return { attempt, reason, error: result.error };
    case "outcome_not_allowed":
    case "resolve_other_cases_first":
    case "registration_not_payable":
    case "already_resolved":
      return { attempt, reason, alert: result.error };
    default:
      // invalid_input or not_found: the page no longer matches the case.
      return { attempt, reason, alert: "unexpected" };
  }
}

// --- Recording an offline payment ----------------------------------------

export type OfflineEntered = {
  method: string;
  reference: string;
  amount: string;
  receivedOn: string;
};

export type OfflineFieldErrors = Extract<
  RecordOfflinePaymentResult,
  { error: "fields_invalid" }
>["errors"];

export type OfflineAlert =
  | "proof_invalid"
  | "already_paid"
  | "batch_not_payable"
  | "registration_not_payable"
  | "type_not_allowed"
  | "too_large"
  | "empty"
  | "upload_failed"
  | "unexpected";

export type OfflineFormState = {
  attempt: number;
  entered: OfflineEntered;
  errors: OfflineFieldErrors;
  alert?: OfflineAlert;
};

/** The form as it first shows: cheque, the batch's amount and today. */
export function offlineStart(defaults: {
  amount: string;
  receivedOn: string;
}): OfflineFormState {
  return {
    attempt: 0,
    entered: { method: "cheque", reference: "", ...defaults },
    errors: {},
  };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** What the form sent, as typed. */
export function offlineEntered(formData: FormData): OfflineEntered {
  return {
    method: text(formData, "method"),
    reference: text(formData, "reference"),
    amount: text(formData, "amount"),
    receivedOn: text(formData, "receivedOn"),
  };
}

/** The state after a recording that didn't go through. */
export function afterRecord(
  previous: OfflineFormState,
  entered: OfflineEntered,
  result:
    | Exclude<RecordOfflinePaymentResult, { ok: true }>
    | Exclude<OfflineAlert, "proof_invalid">
): OfflineFormState {
  const attempt = previous.attempt + 1;
  if (typeof result === "string") {
    return { attempt, entered, errors: {}, alert: result };
  }
  switch (result.error) {
    case "fields_invalid":
      return { attempt, entered, errors: result.errors };
    case "proof_invalid":
    case "already_paid":
    case "batch_not_payable":
    case "registration_not_payable":
      return { attempt, entered, errors: {}, alert: result.error };
    default:
      // invalid_input or not_found: the page no longer matches the batch.
      return { attempt, entered, errors: {}, alert: "unexpected" };
  }
}

/**
 * The alert for a proof upload the server refused: its type, size or
 * emptiness; anything else (the batch vanished) is unexpected.
 */
export function uploadAlert(refusal: string): OfflineAlert {
  return refusal === "type_not_allowed" ||
    refusal === "too_large" ||
    refusal === "empty"
    ? refusal
    : "unexpected";
}
