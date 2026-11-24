// The withdraw form's state between submissions (#127): the reason as
// typed and a problem with it. Pure, so it loads in the client form and
// the Server Action.

import type {
  WithdrawListingInput,
  WithdrawListingResult,
} from "@/server/modules/directory";

export type WithdrawFormState = {
  attempt: number;
  reason: string;
  error?: "reason_too_long" | "transition_not_allowed" | "unexpected";
};

export const WITHDRAW_START: WithdrawFormState = { attempt: 0, reason: "" };

export function withdrawFrom(formData: FormData): WithdrawListingInput {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return { listingId: text("listingId"), reason: text("reason") };
}

export function afterWithdraw(
  previous: WithdrawFormState,
  reason: string,
  result: Exclude<WithdrawListingResult, { ok: true }> | "unexpected"
): WithdrawFormState {
  const attempt = previous.attempt + 1;
  if (result === "unexpected" || result.error === "invalid_input") {
    return { attempt, reason, error: "unexpected" };
  }
  return { attempt, reason, error: result.error };
}
