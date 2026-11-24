"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextAreaField } from "@/components/form";

import { cancelCompetitionAction } from "../_lib/actions";
import { CANCEL_START, type CancelFormState } from "../_lib/form-state";

export type CancelFormLabels = {
  reason: { label: string; hint: string };
  errors: Record<NonNullable<CancelFormState["error"]>, string>;
  alerts: Record<NonNullable<CancelFormState["alert"]>, string>;
  submit: string;
  saving: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/**
 * The super admin's cancellation (#80): why, and one button. Every word
 * comes in `labels`.
 */
export function CancelForm({
  competitionId,
  labels,
}: {
  competitionId: string;
  labels: CancelFormLabels;
}) {
  const [state, formAction] = useActionState(
    cancelCompetitionAction,
    CANCEL_START
  );
  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="competitionId" value={competitionId} />
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : null}
      <TextAreaField
        id="cancel-reason"
        name="reason"
        label={labels.reason.label}
        hint={labels.reason.hint}
        error={state.error ? labels.errors[state.error] : undefined}
        rows={4}
        defaultValue={state.reason}
      />
      <div>
        <SubmitButton pendingLabel={labels.saving}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
