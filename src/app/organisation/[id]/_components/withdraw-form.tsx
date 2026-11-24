"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextAreaField } from "@/components/form";

import { withdrawListingAction } from "../../_lib/actions";
import {
  WITHDRAW_START,
  type WithdrawFormState,
} from "../../_lib/withdraw-state";

export type WithdrawFormLabels = {
  reason: { label: string; hint: string };
  errors: Record<NonNullable<WithdrawFormState["error"]>, string>;
  submit: string;
  submitting: string;
  problem: string;
};

/** An optional reason and one button that withdraws the listing for good. */
export function WithdrawForm({
  listingId,
  maxReasonLength,
  labels,
}: {
  listingId: string;
  maxReasonLength: number;
  labels: WithdrawFormLabels;
}) {
  const [state, formAction] = useActionState(
    withdrawListingAction,
    WITHDRAW_START
  );
  const error = state.error ? labels.errors[state.error] : undefined;
  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="listingId" value={listingId} />
      {error && state.error !== "reason_too_long" ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{error}</p>
        </FormAlert>
      ) : null}
      <TextAreaField
        id="withdraw-reason"
        name="reason"
        rows={3}
        maxLength={maxReasonLength}
        defaultValue={state.reason}
        label={labels.reason.label}
        hint={labels.reason.hint}
        error={state.error === "reason_too_long" ? error : undefined}
      />
      <div>
        <SubmitButton variant="secondary" pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
