// The decision form's state between submissions (#127): the reason as
// typed (the form resets after an action), a problem with it, or an alert
// for the whole form. Pure, so it loads in the client form and the Server
// Action.

import type { DecideListingResult } from "@/server/modules/directory";
// The pure status table: this file loads in the browser too.
import {
  STAFF_LISTING_ACTIONS,
  type StaffListingAction,
} from "@/server/modules/directory/domain/listing-status";

export type DecisionFormState = {
  /** Counts submissions, so the form remounts with the reason below. */
  attempt: number;
  reason: string;
  error?: "reason_required" | "reason_too_long";
  alert?: "transition_not_allowed" | "unexpected";
};

export const START: DecisionFormState = { attempt: 0, reason: "" };

export type DecisionInput = {
  listingId: string;
  decision: StaffListingAction;
  reason: string;
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The decision the pressed button names, or undefined for anything else. */
export function decisionFrom(formData: FormData): DecisionInput | undefined {
  const decision = text(formData, "decision");
  if (!(STAFF_LISTING_ACTIONS as readonly string[]).includes(decision)) {
    return undefined;
  }
  return {
    listingId: text(formData, "listingId"),
    decision: decision as StaffListingAction,
    reason: text(formData, "reason"),
  };
}

/** The state after a decision that didn't go through. */
export function afterDecision(
  previous: DecisionFormState,
  reason: string,
  result: Exclude<DecideListingResult, { ok: true }> | "unexpected"
): DecisionFormState {
  const attempt = previous.attempt + 1;
  if (result === "unexpected") return { attempt, reason, alert: "unexpected" };
  switch (result.error) {
    case "reason_required":
    case "reason_too_long":
      return { attempt, reason, error: result.error };
    case "transition_not_allowed":
      return { attempt, reason, alert: "transition_not_allowed" };
    default:
      // invalid_input or not_found: the page no longer matches the record.
      return { attempt, reason, alert: "unexpected" };
  }
}
