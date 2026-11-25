// The cancel form's state between submissions (#80): the reason as typed
// (the form remounts after an action), a problem with it, or an alert for
// the whole form. Pure, so it loads in the client form and the Server
// Action.

import type { CancelCompetitionResult } from "@/server/modules/competitions";

export type CancelFormState = {
  /** Counts submissions, so the form remounts with what was typed. */
  attempt: number;
  reason: string;
  error?: "reason_required" | "reason_too_long" | "reason_invalid";
  alert?:
    | "already_cancelled"
    | "results_published"
    | "not_found"
    | "unexpected";
};

export const CANCEL_START: CancelFormState = { attempt: 0, reason: "" };

/** The state after a cancellation that didn't go through. */
export function afterCancel(
  previous: CancelFormState,
  reason: string,
  result:
    | Exclude<CancelCompetitionResult, { ok: true }>
    | { ok: false; error: "reason_invalid" }
    | "unexpected"
): CancelFormState {
  const next = { attempt: previous.attempt + 1, reason };
  if (result === "unexpected") return { ...next, alert: "unexpected" };
  switch (result.error) {
    case "reason_invalid":
    case "reason_required":
    case "reason_too_long":
      return { ...next, error: result.error };
    case "results_published":
    case "already_cancelled":
    case "not_found":
      return { ...next, alert: result.error };
    default:
      return { ...next, alert: "unexpected" };
  }
}
