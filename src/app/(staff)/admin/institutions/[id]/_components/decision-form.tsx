"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState } from "react";

import { FormAlert, inputStyles, SubmitButton } from "@/components/form";
import type { InstitutionDecision } from "@/server/modules/institutions";

import { decideInstitutionAction } from "../_lib/actions";
import { START, type DecisionFormState } from "../_lib/decision-state";

export type DecisionFormLabels = {
  reason: { label: string; hint: string };
  errors: Record<NonNullable<DecisionFormState["error"]>, string>;
  alerts: Record<NonNullable<DecisionFormState["alert"]>, string>;
  decide: Record<InstitutionDecision, string>;
  deciding: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/**
 * One reason and a button per decision the status table allows; the
 * first is the primary action. Every word comes in `labels`.
 */
export function DecisionForm({
  institutionId,
  decisions,
  maxReasonLength,
  labels,
}: {
  institutionId: string;
  decisions: readonly InstitutionDecision[];
  maxReasonLength: number;
  labels: DecisionFormLabels;
}) {
  const [state, formAction] = useActionState(decideInstitutionAction, START);
  const error = state.error ? labels.errors[state.error] : undefined;
  const describedBy = ["reason-hint", error ? "reason-error" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="institutionId" value={institutionId} />
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="reason" className="font-semibold text-ink">
          {labels.reason.label}
        </label>
        <p id="reason-hint" className="text-sm text-ink-muted">
          {labels.reason.hint}
        </p>
        {error ? (
          <p
            id="reason-error"
            className="flex items-start gap-2 font-semibold text-danger"
          >
            <OctagonAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0"
            />
            <span>{error}</span>
          </p>
        ) : null}
        <textarea
          id="reason"
          name="reason"
          required
          rows={4}
          maxLength={maxReasonLength}
          defaultValue={state.reason}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={inputStyles}
        />
      </div>
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
