"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/form/submit-button";

import { reverseEntryAction } from "../_lib/actions";
import { initialFormState } from "../_lib/form-state";
import { LedgerFormFeedback, type LedgerFeedbackLabels } from "./form-feedback";

export function ReversePostingForm({
  seq,
  labels,
}: {
  seq: string;
  labels: { saving: string; submit: string; feedback: LedgerFeedbackLabels };
}) {
  const [state, action] = useActionState(
    reverseEntryAction.bind(null, seq),
    initialFormState
  );
  return (
    <form action={action} className="space-y-4">
      <LedgerFormFeedback state={state} labels={labels.feedback} />
      <SubmitButton pendingLabel={labels.saving} variant="secondary">
        {labels.submit}
      </SubmitButton>
    </form>
  );
}
