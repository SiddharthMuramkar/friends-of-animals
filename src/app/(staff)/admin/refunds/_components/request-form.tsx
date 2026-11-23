"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextAreaField } from "@/components/form";

import { requestRefundAction } from "../_lib/actions";
import { REQUEST_START, type RequestFormState } from "../_lib/form-state";

const CHOICE =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-strong bg-surface px-4 py-2 has-checked:border-link";

export type RequestFormLabels = {
  students: { legend: string; hint: string };
  reason: { label: string; hint: string };
  errors: Record<NonNullable<RequestFormState["error"]>, string>;
  alerts: Record<NonNullable<RequestFormState["alert"]>, string>;
  submit: string;
  saving: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/**
 * The students a refund may list (each with its own label), a reason, and
 * one button. Ticking none asks for every student left. Every word comes
 * in `labels` and `students`.
 */
export function RequestForm({
  batchId,
  students,
  maxReasonLength,
  labels,
}: {
  batchId: string;
  students: { registrationId: string; label: string }[];
  maxReasonLength: number;
  labels: RequestFormLabels;
}) {
  const [state, formAction] = useActionState(
    requestRefundAction,
    REQUEST_START
  );
  const ticked = new Set(state.registrationIds);
  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="batchId" value={batchId} />
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : null}
      <fieldset
        className="flex flex-col gap-3"
        aria-describedby="request-students-hint"
      >
        <legend className="mb-1 font-semibold text-ink">
          {labels.students.legend}
        </legend>
        <p id="request-students-hint" className="text-sm text-ink-muted">
          {labels.students.hint}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {students.map((student) => (
            <label key={student.registrationId} className={CHOICE}>
              <input
                type="checkbox"
                name="registrationId"
                value={student.registrationId}
                defaultChecked={ticked.has(student.registrationId)}
                className="size-5 shrink-0 accent-link"
              />
              <span className="wrap-anywhere">{student.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <TextAreaField
        id="request-reason"
        name="reason"
        label={labels.reason.label}
        hint={labels.reason.hint}
        error={state.error ? labels.errors[state.error] : undefined}
        required
        rows={4}
        maxLength={maxReasonLength}
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
