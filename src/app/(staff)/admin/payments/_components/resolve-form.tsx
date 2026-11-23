"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState } from "react";

import { FormAlert, inputStyles, SubmitButton } from "@/components/form";
import type { PaymentReviewOutcome } from "@/server/modules/payments/domain/review-case";

import { resolveReviewCaseAction } from "../_lib/actions";
import { RESOLVE_START, type ResolveFormState } from "../_lib/form-state";

export type ResolveFormLabels = {
  reason: { label: string; hint: string };
  errors: Record<NonNullable<ResolveFormState["error"]>, string>;
  alerts: Record<NonNullable<ResolveFormState["alert"]>, string>;
  outcomes: Record<PaymentReviewOutcome, string>;
  saving: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/**
 * One reason and a button per outcome the case allows; the first is the
 * primary action. Every word comes in `labels`.
 */
export function ResolveForm({
  caseId,
  outcomes,
  maxReasonLength,
  labels,
}: {
  caseId: string;
  outcomes: readonly PaymentReviewOutcome[];
  maxReasonLength: number;
  labels: ResolveFormLabels;
}) {
  const [state, formAction] = useActionState(
    resolveReviewCaseAction,
    RESOLVE_START
  );
  const error = state.error ? labels.errors[state.error] : undefined;
  const describedBy = [
    "resolve-reason-hint",
    error ? "resolve-reason-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="caseId" value={caseId} />
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="resolve-reason" className="font-semibold text-ink">
          {labels.reason.label}
        </label>
        <p id="resolve-reason-hint" className="text-sm text-ink-muted">
          {labels.reason.hint}
        </p>
        {error ? (
          <p
            id="resolve-reason-error"
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
          id="resolve-reason"
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
        {outcomes.map((outcome, index) => (
          <SubmitButton
            key={outcome}
            name="outcome"
            value={outcome}
            variant={index === 0 ? "primary" : "secondary"}
            pendingLabel={labels.saving}
          >
            {labels.outcomes[outcome]}
          </SubmitButton>
        ))}
      </div>
    </form>
  );
}
