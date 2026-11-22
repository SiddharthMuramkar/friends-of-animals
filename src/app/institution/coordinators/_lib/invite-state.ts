// What the invite form shows after a submission, from inviteCoordinator's
// result, and what the remove and withdraw buttons report back. Pure, so
// the mapping is tested without a page.

import type {
  InviteCoordinatorResult,
  RemoveCoordinatorResult,
  RevokeInvitationResult,
} from "@/server/modules/institutions/coordinators";

export type InviteProblem =
  | "invalid_input"
  | "sms_disabled"
  | "already_coordinator"
  | "cannot_invite_self"
  | "institution_not_verified"
  | "failed";

export type InviteFormState = {
  /** What stays in the field: cleared once an invitation is sent. */
  identifier: string;
  /** Who the last invitation went to, as typed. */
  sentTo?: string;
  problem?: InviteProblem;
};

export const START: InviteFormState = { identifier: "" };

/** The state plus its words, translated by the action on the server. */
export type InviteFormView = InviteFormState & {
  text: { sent?: string; problem?: string };
};

export const START_VIEW: InviteFormView = { ...START, text: {} };

export function inviteFormState(
  entered: string,
  result: InviteCoordinatorResult
): InviteFormState {
  if (result.ok) return { identifier: "", sentTo: entered.trim() };
  // Every invalid field is the one the person typed in.
  if (result.error === "invalid_input") {
    return { identifier: entered, problem: "invalid_input" };
  }
  return { identifier: entered, problem: result.error };
}

/** What the coordinators page says after a remove or withdraw button. */
export type ManageOutcome =
  | "removed"
  | "withdrawn"
  | "not_found"
  | "already_accepted"
  | "revoked";

export const MANAGE_OUTCOMES: readonly ManageOutcome[] = [
  "removed",
  "withdrawn",
  "not_found",
  "already_accepted",
  "revoked",
];

export function isManageOutcome(value: unknown): value is ManageOutcome {
  return MANAGE_OUTCOMES.includes(value as ManageOutcome);
}

export function removeOutcome(result: RemoveCoordinatorResult): ManageOutcome {
  // Only not_found is ever shown: an institution no longer verified gets
  // the page's notVerified state instead of the list and any outcome, and
  // bad input never comes from the page's own buttons.
  return result.ok ? "removed" : "not_found";
}

export function withdrawOutcome(result: RevokeInvitationResult): ManageOutcome {
  if (result.ok) return "withdrawn";
  switch (result.error) {
    case "already_accepted":
    case "revoked":
      return result.error;
    default:
      // Bad input names nothing, and an expired link can still be
      // withdrawn, so neither reaches here from a real button.
      return "not_found";
  }
}
