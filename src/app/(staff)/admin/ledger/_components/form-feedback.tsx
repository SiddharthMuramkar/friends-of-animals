import { useEffect, useRef } from "react";

import { FormAlert } from "@/components/form/form-alert";

import type { LedgerErrorCode, LedgerFormState } from "../_lib/form-state";

export type LedgerFeedbackLabels = {
  problem: string;
  saved?: string;
  errors: Partial<Record<LedgerErrorCode, string>>;
};

export function LedgerFormFeedback({
  state,
  labels,
}: {
  state: LedgerFormState;
  labels: LedgerFeedbackLabels;
}) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    summary.current?.focus();
  }, [state]);

  if (state.error) {
    return (
      <FormAlert
        ref={summary}
        tabIndex={-1}
        tone="danger"
        label={labels.problem}
      >
        <p>{labels.errors[state.error]}</p>
      </FormAlert>
    );
  }
  return state.saved ? <output>{labels.saved}</output> : null;
}
