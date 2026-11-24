"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextAreaField } from "@/components/form";

import { decideRefundAction } from "../_lib/actions";
import { DECISION_START, type DecisionFormState } from "../_lib/form-state";

export type RefundDecision = "approve" | "reject" | "retry";

export type DecisionFormLabels = {
  note: { label: string; hint: string };
  errors: Record<NonNullable<DecisionFormState["error"]>, string>;
  alerts: Record<NonNullable<DecisionFormState["alert"]>, string>;
  decisions: Partial<Record<RefundDecision, string>>;
  saving: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/**
 * Finance's decision on a refund: a note and a button per decision
 * offered (approve or reject a request; retry or close a failed one). The
 * first button is the primary action. Every word comes in `labels`.
 */
export function DecisionForm({
  refundId,
  decisions,
  maxNoteLength,
  labels,
}: {
  refundId: string;
  decisions: readonly RefundDecision[];
  maxNoteLength: number;
  labels: DecisionFormLabels;
}) {
  const [state, formAction] = useActionState(
    decideRefundAction,
    DECISION_START
  );
  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="refundId" value={refundId} />
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : null}
      {decisions.includes("reject") ? (
        <TextAreaField
          id="refund-note"
          name="note"
          label={labels.note.label}
          hint={labels.note.hint}
          error={state.error ? labels.errors[state.error] : undefined}
          rows={3}
          maxLength={maxNoteLength}
          defaultValue={state.note}
        />
      ) : null}
      <div className="flex flex-wrap gap-3">
        {decisions.map((decision, index) => (
          <SubmitButton
            key={decision}
            name="decision"
            value={decision}
            variant={index === 0 ? "primary" : "secondary"}
            pendingLabel={labels.saving}
          >
            {labels.decisions[decision]}
          </SubmitButton>
        ))}
      </div>
    </form>
  );
}
