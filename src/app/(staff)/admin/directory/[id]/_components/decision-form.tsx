"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextAreaField } from "@/components/form";
import type { StaffListingAction } from "@/server/modules/directory/domain/listing-status";

import { decideListingAction } from "../_lib/actions";
import { START, type DecisionFormState } from "../_lib/decision-state";

export type DecisionFormLabels = {
  reason: { label: string; hint: string };
  errors: Record<NonNullable<DecisionFormState["error"]>, string>;
  alerts: Record<NonNullable<DecisionFormState["alert"]>, string>;
  decide: Record<StaffListingAction, string>;
  deciding: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/**
 * One reason and a button per decision the status table allows; the
 * first is the primary action. Every word comes in `labels`.
 */
export function DecisionForm({
  listingId,
  decisions,
  maxReasonLength,
  labels,
}: {
  listingId: string;
  decisions: readonly StaffListingAction[];
  maxReasonLength: number;
  labels: DecisionFormLabels;
}) {
  const [state, formAction] = useActionState(decideListingAction, START);
  const error = state.error ? labels.errors[state.error] : undefined;
  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="listingId" value={listingId} />
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : null}
      <TextAreaField
        id="reason"
        name="reason"
        required
        rows={4}
        maxLength={maxReasonLength}
        defaultValue={state.reason}
        label={labels.reason.label}
        hint={labels.reason.hint}
        error={error}
      />
      <div className="flex flex-wrap gap-3">
        {decisions.map((decision, index) => (
          <SubmitButton
            key={decision}
            name="decision"
            value={decision}
            variant={index === 0 ? "primary" : "secondary"}
            pendingLabel={labels.deciding}
          >
            {labels.decide[decision]}
          </SubmitButton>
        ))}
      </div>
    </form>
  );
}
