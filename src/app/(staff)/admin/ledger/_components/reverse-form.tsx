"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/form/submit-button";

import { reverseEntryAction } from "../_lib/actions";
import { copy } from "../_lib/copy";
import { initialFormState } from "../_lib/form-state";
import { LedgerFormFeedback } from "./form-feedback";

export function ReversePostingForm({ seq }: { seq: string }) {
  const [state, action] = useActionState(
    reverseEntryAction.bind(null, seq),
    initialFormState
  );
  return (
    <form action={action} className="space-y-4">
      <LedgerFormFeedback state={state} />
      <SubmitButton pendingLabel={copy.saving} variant="secondary">
        {copy.detail.reverse}
      </SubmitButton>
    </form>
  );
}
